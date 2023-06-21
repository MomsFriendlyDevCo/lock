var _ = require('lodash');
var crypto = require('crypto');
var debug = require('debug')('lock');
var marshal = require('@momsfriendlydevco/marshal');
var mongoose = require('mongoose');
var timestring = require('timestring');

var lock = function(options) {
	this.settings = {
		...lock.defaults,
		...options,
	};

	this.schema; // Mongo schema when database connection completes
	this.model; // Mongo model when above completes


	/**
	* Set one or more settings
	* @param {string|Object} key A single key to set or an object to merge, dotted notation supported
	* @returns {Lock} This chainable instance
	*/
	this.set = (key, val) => {
		if (!key) {
			// Pass
		} else if (_.isString(key)) {
			_.set(this.settings, key, val);
		} else {
			_.merge(this.settings, key);
		}
		return this;
	};


	/**
	* Verify settings and connect to database
	* @param {Object} [settings] Optional settings object
	* @returns {Promise} A promise which will resolve when complete
	*/
	this.init = settings => Promise.resolve()
		.then(() => debug('Creating Lock instance'))
		.then(()=> this.set(settings))
		// Sanity checks {{{
		.then(()=> {
			['mongodb.uri', 'mongodb.collection']
				.forEach(key => {
					if (!_.has(this.settings, key)) throw new Error(`Missing setting: ${key}`);
				});
		})
		// }}}
		.then(()=> mongoose.set('useFindAndModify', false))
		.then(()=> mongoose.set('useCreateIndex', true))
		// FIXME: Setting which enables the use of openUri to avoid connection pool issues?
		.then(()=> mongoose.connect(this.settings.mongodb.uri, this.settings.mongodb.options))
		.then(()=> this.schema = new mongoose.Schema({
			key: {type: mongoose.Schema.Types.String, index: {unique: true}},
			expiry: {type: mongoose.Schema.Types.Date},
			ttl: {type: mongoose.Schema.Types.Date},
			created: {type: mongoose.Schema.Types.Date},
		}, {strict: false}))
		.then(()=> this.model = mongoose.model(this.settings.mongodb.collection, this.schema))
		.finally(() => debug('Connected'));


	/**
	* Retrieve lock data
	* @param {*} key The key to retrieve
	* @returns {Promise <Object>} The lock data, this includes the original key and additional fields attached to it. If no lock is found this returns undefined
	*/
	this.get = key => Promise.resolve()
		.then(()=> key = this.hash(key))
		.then(keyHash => this.model.findOne({key: keyHash}).lean())
		.then(doc => _.omit(doc, this.settings.omitFields))


	/**
	* Request if a lock exists
	* @param {*} key The key to check, if a non-string this is run via hash() first
	* @returns {Promise <boolean>} A promise which will resolve with a boolean indicating if the lock exists
	*/
	this.exists = key => Promise.resolve()
		.then(()=> key = this.hash(key))
		.then(keyHash => this.model.findOne({
			key: {$eq: keyHash},
			expiry: {$gt: new Date()},
			ttl: {$gt: new Date()},
		}).select('_id').lean())
		.then(doc => {
			var exists = !!doc;
			debug('Check key exists', key, '?', exists);
			return exists;
		});


	/**
	* Attempt to create a lock, returning a boolean for success
	* @param {*} key The key to lock, hashed if necessary via hash()
	* @param {Date|String|Number} [expiry] Optional lock expiry timestring / interval or date
	* @param {Object} fields Additional fields to pass, can contain `{created, expiry}`
	* @param {Date|String|Number} [options.expiry] Optional lock expiry timestring / interval or date
	* @param {Date} [options.created] Overriding lock creation date if not now
	* @returns {Promise <boolean>} A promise which will resolve with true/false if the lock was created
	*/
	this.create = (key, expiry, fields) => Promise.resolve()
		.then(()=> { // Argument mangling
			if (typeof expiry == 'object' && !(expiry instanceof Date)) { // Assume we're being called as (key, fields)
				[key, fields] = [key, expiry];
			} else if (typeof expiry == 'string' || isFinite(expiry) || expiry instanceof Date) { // Parse expiry
				[key, fields] = [key, {
					expiry,
					...fields,
				}];
			}
		})
		.then(()=> this.clean()) // We must remove expired records to avoid unique key conflicts
		.then(()=> this.hash(key))
		.then(keyHash => { debug('Create lock with key', keyHash); return keyHash })
		.then(keyHash => this.model.create({
			key: keyHash,
			created: new Date(),
			...fields,
			expiry:
				isFinite(expiry) ? new Date(Date.now() + expiry) // Given a number offset
				: typeof expiry == 'string' ? new Date(Date.now() + timestring(expiry, 'ms')) // Parse timestring
				: expiry instanceof Date ? expiry // Given a real date
				: new Date(Date.now()+this.settings.expiry), // Use default
			ttl: new Date(Date.now()+this.settings.ttl),
			// Legacy expansion into main lock object
			...(this.settings.includeKeys && _.isObject(key) ? key : undefined),
			// Additional meta key to retain reserved keys like `id`
			meta: {...(this.settings.includeKeys && _.isObject(key) ? key : undefined)}
		}))
		.then(()=> {
			debug('Key created', key);
			return true;
		})
		.catch(e => {
			debug('Error creating key', key, e);
			return false;
		});


	/**
	* Update the data behind an existing lock
	* @param {*} key The key to lock, hashed if necessary via hash()
	* @param {Object} fields Fields to update, can contain `{created, expiry}`
	* @returns {Promise} A promise which will resolve with the updated lock
	*/
	this.update = (key, fields) => Promise.resolve()
		.then(()=> key = this.hash(key))
		.then(()=> this.model.updateOne({key}, fields));


	/**
	* Release a lock
	* @param {*} key The key to release, hashed if neccessary via hash()
	* @returns {Promise <boolean>} A promise which will resolve when the lock has been removed with a boolean indicating whether the lock existed
	*/
	this.release = key => Promise.resolve()
		.then(()=> key = this.hash(key))
		.then(()=> this.model.deleteOne({key}))
		.then(()=> true)
		.catch(()=> false);


	/**
	* Remove all expired locks from the database
	* @returns {Promise} A promise which will resolve when the cleaning has completed
	*/
	this.clean = ()=> this.model.deleteMany({
		$or: [
			{expiry: {$lt: new Date()}},
			{ttl: {$lt: new Date()}},
		]
	});


	/**
	* Repeatedly checks if a key exists a given number of times (with configurable retires / backoff)
	* If the key is eventually available, it is created otherwise this function throws
	* @param {*} key The key to check + allocate, if a non-string this is run via hash() first
	* @param {Object} [options] Additional options to mutate behaviour, other options are passed to `create()`
	* @param {Number} [options.retries=5] Maximum number of retries to attempt
	* @param {Number} [options.delay=250] Time in milliseconds to wait for a lock using the default backoff system
	* @param {Boolean} [options.create=true] If a lock can be allocated, auto allocate it before resuming
	* @param {Function} [options.backoff] Function to calculate timing backoff, should return the delay to use. Called as `(attempt, max, settings)`. Defaults to simple linear backoff using `delay` + some millisecond fuzz
	* @param {Function} [options.onLocked] Async function to call each time a lock is detected. Called as `(attempt, max, settings)`
	* @param {Function} [options.onCreate] Async function to call if allocating a lock is successful. Called as `(attempt, max, settings)`
	* @param {Function} [options.onExhausted] Async function to call if allocating a lock failed after multiple retries. Called as `(attempt, max, settings)`. Should throw
	* @returns {Promise} A promise which resolves when the operation has completed with the obtained lock (or null if `onExhausted` didnt throw)
	*/
	this.spin = (key, options) => {
		let settings = {
			key: this.hash(key),
			retries: 5,
			delay: 250,
			create: true,
			backoff: (attempt, max, settings) => (attempt * settings.delay) + Math.floor(Math.random() * 100),
			onLocked: (attempt, max, settings) => console.warn('Unable to allocate lock', settings.key, `${attempt}/${max}`),
			onCreate: (attempt, max, settings) => {},
			onExhausted: (attempt, max, settings) => { throw new Error(`Unable to alocate ${settings.key} after ${attempt} attempts`) },
			...options,
		};

		return new Promise((resolve, reject) => {
			let attempt = 0;
			let tryLock = ()=> this.exists(settings.key)
				.then(lockExists => {
					if (lockExists && ++attempt > settings.retries) { // Locked + exceeded number of tries
						return Promise.resolve(settings.onExhausted(attempt, settings.retries, settings))
							.then(()=> null)
							.catch(reject);
					} else if (lockExists) { // Lock already exists
						return Promise.resolve(settings.onLocked(attempt, settings.retries, settings))
							.then(()=> settings.backoff(attempt, settings.retries, settings))
							.then(delay => new Promise(resolve => {
								if (!isFinite(delay)) throw new Error('Expected onBackoff to return a delay - didnt get back a finite number');
								setTimeout(resolve, delay);
							}))
							.then(tryLock)
							.catch(reject)
					} else { // No lock exits - resolve outer promise
						return Promise.resolve(settings.onCreate(attempt, settings.retries, settings))
							.then(()=> settings.create && this.create(settings.key, options))
							.then(()=> resolve(settings.key))
							.catch(reject)
					}
				});
			tryLock(); // Kickoff initial lock-check cycle
		});
	};


	/**
	* Remove ALL locks from the database
	* This is only really useful when debugging
	* @returns {Promise} A promise which will resolve when the clearing has completed
	*/
	this.clear = ()=> this.model.deleteMany();


	/**
	* Keep-alive
	* Updates time-to-live so that disconnected clients can be detected
	* @param {*} key The key to hash
	* @returns {Promise} A promise which will resolve with the updated lock
	*/
	this.alive = key => Promise.resolve()
		.then(()=> key = this.hash(key))
		.then(()=> this.model.updateOne({key}, {ttl: new Date(Date.now()+this.settings.ttl)}));


	/**
	* Return a string varient of a complex object
	* If passed a string this returns the same value, for everything else an SHA-256 hash is used instead
	* @param {*} key The key to hash
	* @returns {string} A hash of the input key
	*/
	this.hash = key =>
		_.isString(key)
			? key
			: crypto.createHash('sha256')
				.update(marshal.serialize(key, {symetric: true}))
				.digest('hex')


	/**
	* Close the module and release the database connection
	* @returns {Promise} A promise which will resolve when the connection has been released
	*/
	this.destroy = ()=> this.model
		? mongoose.connection.close()
		: Promise.resolve();


	return this;
};

lock.defaults = {
	expiry: 1000 * 60 * 60, // 1 hour
	ttl: 1000 * 60 * 1, // 1 min
	mongodb: {
		uri: 'mongodb://localhost/mfdc-cache',
		collection: 'locks',
		options: {
			useNewUrlParser: true,
			useUnifiedTopology: true,
		},
	},
	omitFields: ['_id', '__v'],
	includeKeys: true,
};

module.exports = lock;
