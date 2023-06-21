@MomsFriendlyDevCo/Lock
=======================
Async locking mechanism based on MongoDB.

```javascript
var Lock = require('@momsfriendlydevco/lock');

var locker = new Lock();
var timer;

locker.init()
	.then(()=> locker.create({Foo: 'Foo!', bar: 123}))
	.then(()=> timer = setInterval(locker.alive({Foo: 'Foo!', bar: 123}), 30000))
	.then(()=> locker.exists({Foo: 'Foo!', bar: 123})) //= true
	.then(()=> clearInterval(timer))
	.then(()=> locker.release({Foo: 'Foo!', bar: 123}))
```


API
===

Lock(settings)
--------------
Main constructor.
Requires instance.init() to be called before the instance is functional.


Lock.defaults
-------------
Default settings.

| Setting              | Type     | Default                            | Description                                     |
|----------------------|----------|------------------------------------|-------------------------------------------------|
| `expiry`             | `number` | 1 hour                             | The time in milliseconds until the lock expires |
| `ttl`             | `number` | 1 min                             | The time in milliseconds until keep-alive expires |
| `mongodb`            | `object` | See below                          | MongoDB connection options                      |
| `mongodb.uri`        | `string` | `"mongodb://localhost/mfdc-cache"` | The MongoDB URI to connect to                   |
| `mongodb.collection` | `string` | `"locks"`                          | The name of the collection to use               |
| `mongodb.options`    | `object` | See code                           | Additional connection options to use            |
| `omitFields`         | `array`  | `['_id', '__v']`                   | Which fields to autmatically skip when using `get()` |
| `includeKeys`        | `boolean` | `true`                            | Also save the key field values, reduces overhead to disable this |


lock.set(key, val)
------------------
Either set one setting or multiple if passed an object. Dotted notation is supported.


lock.init(settings)
-------------------
Check all settings and connect to the database.


lock.create(key, expiry, additionalFields)
------------------------------------------
Attempt to create a lock, returning a `Promise<Boolean>` for success.
Expiry is optional and can be a [timestring](https://github.com/mike182uk/timestring), Date or number of milliseconds.
Key is run via `lock.hash()` if it is not already a string.


lock.get(key)
-------------
Return a `Promise <object>` of a lock and all its attached data.
The result object will either be undefined (if it doesn't exist) or the lock with the original keys + additionalFields.
Key is run via `lock.hash()` if it is not already a string.


lock.update(key, fields)
------------------------
Save data back to an existing lock.
Key is run via `lock.hash()` if it is not already a string.
Returns a promise.


lock.exists(key)
----------------
Return a `Promise <boolean>` if a lock already exists.
Key is run via `lock.hash()` if it is not already a string.


lock.release(key)
-----------------
Release a lock.
Key is run via `lock.hash()` if it is not already a string.


lock.clean()
------------
Remove all expired locks.


lock.clear()
------------
Remove *all* locks.


lock.alive(item)
---------------
Update a locks `ttl` in order to detect disconnected clients


lock.hash(item)
---------------
Return the input if its already a string, if not create a symetric hash of the object (i.e. reorder keys).


lock.destroy()
--------------
Release the database connection and terminate.
