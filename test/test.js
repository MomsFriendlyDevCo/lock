var _ = require('lodash');
var expect = require('chai').expect;
var Lock = require('..');
var mlog = require('mocha-logger');

describe('@momsfriendlydevco/lock', ()=> {
	var lock;
	before('set up the module', ()=> lock = new Lock());
	before('initalize', ()=> lock.init());
	before('clear existing contents', ()=> lock.clear());
	after('destroy', ()=> lock.destroy());

	it('hash()', ()=> {
		expect(lock.hash('hello')).to.be.a('string');
		expect(lock.hash()).to.be.a('string');
		expect(lock.hash({one: 'One'})).to.be.a('string');
		expect(lock.hash(123)).to.be.a('string');
		expect(lock.hash({one: 1, two: 2})).to.be.equal(lock.hash({two: 2, one: 1}));
	});

	it('should complete a lock lifecycle', ()=> Promise.resolve()
		.then(()=> lock.exists('hello'))
		.then(res => expect(res).to.be.false)
		.then(()=> lock.create('hello'))
		.then(res => expect(res).to.be.true)
		.then(()=> lock.exists('hello'))
		.then(res => expect(res).to.be.true)
		.then(()=> lock.release('hello'))
		.then(res => expect(res).to.be.true)
		.then(()=> lock.exists('hello'))
		.then(res => expect(res).to.be.false)
	);

	it('should prevent collisions', ()=> Promise.resolve()
		.then(()=> Promise.all([
			lock.create({foo: 'Foo!'}).catch(()=> false),
			lock.create({foo: 'Foo!'}).catch(()=> false),
			lock.create({foo: 'Foo!'}).catch(()=> false),
		]))
		.then(res => {
			expect(res.filter(r => r).length).to.be.equal(1);
			expect(res.filter(r => !r).length).to.be.equal(2);
		})
	);

	it('should randomly create and destroy locks', function() {
		this.timeout(10 * 1000);
		var stats = {clashes: 0, created: 0};
		var created = new Set();
		var create = ()=> new Promise((resolve, reject) => {
			var id = 'lock-' + _.random(1, 9);
			lock.create(id)
				.then(res => {
					if (res === false) { // Correct response - detected clash
						stats.clashes++;
					} else if (!created.has(id) && res === true) { // Correct response - no clash
						stats.created++;
					}
					resolve();
				})
				.catch(reject)
		});

		return Promise.all(Array.from(new Array(100)).map(i => create()))
			.then(()=> mlog.log('Created', stats.created, 'locks with', stats.clashes, 'clashes'))
	});

	it('should store custom fields and update them', function() {
		this.timeout(10 * 1000);
		var key = {quz: 'Quz!', quark: 'Quark!'};
		var data1 = {quomp: 'Qwomp!', qclark: 'Qlark!'};

		return lock.create(key, data1)
			.then(()=> lock.get(key))
			.then(doc => expect(_.omit(doc, ['created', 'expiry', 'key'])).to.be.deep.equal({...key, ...data1}))
			.then(()=> lock.update(key, {qclark: 'Qklark!'}))
			.then(()=> lock.get(key))
			.then(doc => expect(_.omit(doc, ['created', 'expiry', 'key'])).to.be.deep.equal({...key, ...data1, qclark: 'Qklark!'}))
	});

});
