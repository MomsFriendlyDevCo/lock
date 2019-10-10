var _ = require('lodash');
var crypto = require('crypto');
var debug = require('debug')('lock');
var marshal = require('@momsfriendlydevco/marshal');
var mongoose = require('mongoose');

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
		.then(()=> mongoose.connect(this.settings.mongodb.uri, this.settings.mongodb.options))
		.then(()=> this.schema = new mongoose.Schema({
			key: {type: mongoose.Schema.Types.String, index: {unique: true}},
			expiry: {type: mongoose.Schema.Types.Date},
			created: {type: mongoose.Schema.Types.Date},
		}, {strict: false}))
		.then(()=> this.model = mongoose.model(this.settings.mongodb.collection, this.schema));


	/**
	* Retrieve lock data
	* @param {*} key The key to retrieve
	* @returns {Promise <Object>} The lock data, this includes the original key and additional fields attached to it. If no lock is found this returns undefined
	*/
	this.get = key => Promise.resolve()
		.then(()=> key = this.hash(key))
		.then(()=> this.model.findOne({key}).lean())
		.then(doc => _.omit(doc, this.settings.omitFields))


	/**
	* Request if a lock exists
	* @param {*} key The key to check, if a non-string this is run via hash() first
	* @returns {Promise <boolean>} A promise which will resolve with a boolean indicating if the lock exists
	*/
	this.exists = key => Promise.resolve()
		.then(()=> key = this.hash(key))
		.then(()=> this.model.findOne({key, expiry: {$gt: new Date()}}).select('_id').lean())
		.then(doc => {
			var exists = !!doc;
			debug('Check key exists', key, '?', exists);
			return exists;
		});


	/**
	* Attempt to create a lock, returning a boolean for success
	* @param {*} key The key to lock, hashed if necessary via hash()
	* @param {Object} fields Additional fields to pass, can contain `{created, expiry}`
	* @returns {Promise <boolean>} A promise which will resolve with true/false if the lock was created
	*/
	this.create = (key, fields) => Promise.resolve()
		.then(()=> this.hash(key))
		.then(keyHash => { debug('Create lock with key', keyHash); return keyHash })
		.then(keyHash => this.model.create({
			key: keyHash,
			created: new Date(),
			expiry: new Date(Date.now()+this.settings.expiry),
			...(this.settings.includeKeys && _.isObject(key) ? key : undefined),
			...fields,
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
	* @returns {Promise} A promise which will update with the updated lock
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
		expiry: {$lt: new Date()},
	});


	/**
	* Remove ALL locks from the database
	* This is only really useful when debugging
	* @returns {Promise} A promise which will resolve when the clearing has completed
	*/
	this.clear = ()=> this.model.deleteMany();


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
	mongodb: {
		uri: 'mongodb://localhost/mfdc-cache',
		collection: 'locks',
		options: {
			useNewUrlParser: true,
		},
	},
	omitFields: ['_id', '__v'],
	includeKeys: true,
};

module.exports = lock;
