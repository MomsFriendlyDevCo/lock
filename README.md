@MomsFriendlyDevCo/Lock
=======================
Async locking mechanism based on MongoDB.

```javascript
var Lock = require('@momsfriendlydevco/lock');

var locker = new Lock();

locker.init()
	.then(()=> locker.create({Foo: 'Foo!', bar: 123})
	.then(()=> locker.has({Foo: 'Foo!', bar: 123})) //= true
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
| `mongodb`            | `object` | See below                          | MongoDB connection options                      |
| `mongodb.uri`        | `string` | `"mongodb://localhost/mfdc-cache"` | The MongoDB URI to connect to                   |
| `mongodb.collection` | `string` | `"locks"`                          | The name of the collection to use               |
| `mongodb.options`    | `object` | See code                           | Additional connection options to use            |


lock.set(key, val)
------------------
Either set one setting or multiple if passed an object. Dotted notation is supported.


lock.init(settings)
-------------------
Check all settings and connect to the database.


lock.create(key, additionalFields)
----------------------------------
Attempt to create a lock, returning a `Promise <boolean>` for success.
Key is run via `lock.hash()` if it is not already a string.


lock.get(key)
-------------
Return a `Promise <object>` of a lock and all its attached data.
The result object will either be undefined (if it doesn't exist) or the lock with the original keys + additionalFields.
Key is run via `lock.hash()` if it is not already a string.


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


lock.hash(item)
---------------
Return the input if its already a string, if not create a symetric hash of the object (i.e. reorder keys).


lock.destroy()
--------------
Release the database connection and terminate.
