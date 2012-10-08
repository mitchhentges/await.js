// ########################################################################
// PROLOGUE

/*
Copyright (c) 2012 by Greg Reimer
https://github.com/greim
http://obadger.com/

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(function(){

  // ########################################################################
  // CHAPTER 1 - DECLARATION

  var slice = [].slice;

  var Promise = function(){

    /*
    Using convention of uppercase names for vars scoped to Promise()
    */
    var PROMISE = this;

    if (!(PROMISE instanceof Promise)) {
      throw new Error("Must use 'new' keyword.");
    }

    var ARGS = slice.call(arguments);

    /*
    Keep track of things this promise needs,
    and whether they've been fulfilled.
    */
    var SLOTS = {};

    /*
    Optionally support construction on an array:
        new Promise(['foo','bar','baz'])
    */
    if (ARGS.length === 1 && typeof ARGS[0].join === 'function') {
      ARGS = ARGS[0];
    }

    /*
    Otherwise, support construction on a series of string params:
        new Promise('foo','bar','baz')
    */
    ARGS.forEach(function(arg){
      SLOTS[arg] = false;
    });

    /*
    The ALLBACKS array contains keep, fail and resolve callbacks.
    */
    var ALLBACKS = [];

    /*
    The kept status of this promise. If truthy, the promise has been kept.
    Empty promises are considered automatically kept.
    */
    var SUCCESS = !Object.keys(SLOTS).length;

    /*
    The failure status of this promise. If truthy, the promise has been
    broken.
    */
    var FAILURE = false;

    /*
    This keeps track of any pieces of data that the user of this API
    is collecting via this promise.
    */
    var GOT = {};

    // ########################################################################
    // CHAPTER 2 - RUNNING

    /**
    Runs the given callback, passing it an instance of the promise,
    and then returning that same instance.
    */
    PROMISE.run = function(cb, ctx){
      ctx = ctx || window;
      cb.call(ctx, PROMISE);
      return PROMISE;
    };

    // ########################################################################
    // CHAPTER 3 - EVENTS

    function on(event, cb, ctx){
      if (typeof cb !== 'function') {
        throw new Error('No callback provided.');
      }
      ctx = ctx || window;

      /*
      NOTE: It's possible for both SUCCESS and FAILURE to be
      true at the same time. In such cases SUCCESS pre-empts
      FAILURE.
      */

      if (SUCCESS || FAILURE) {
        if (event === 'resolve') {
          cb.call(ctx);
        }
        if (SUCCESS) {
          if (event === 'keep') {
            cb.call(ctx, GOT);
          }
        } else {
          if (event === 'fail') {
            cb.call(ctx, FAILURE);
          }
        }
      } else {
        ALLBACKS.push({
          callback:cb,
          context:ctx,
          type:event
        });
      }

      return PROMISE;
    }

    PROMISE.onfail = function(cb, ctx){
      return on('fail', cb, ctx);
    };
    PROMISE.onkeep = function(cb, ctx){
      return on('keep', cb, ctx);
    };
    PROMISE.onresolve = function(cb, ctx){
      return on('resolve', cb, ctx);
    };

    // ########################################################################
    // CHAPTER 4 - AUTO-TIMEOUT

    /**
    Automatically fail the promise after this many milliseconds.
    */
    PROMISE.timeout = function(millis){
      setTimeout(function(){
        if (SUCCESS || FAILURE) {return;}
        var waiting = Object.keys(GOT).filter(function(item){
          return GOT[item] === undefined;
        });
        var message = 'Timed out waiting on '+waiting.join(' and ');
        PROMISE.fail(message);
      }, millis);
      return PROMISE;
    };

    // ########################################################################
    // CHAPTER 5 - PROVISIONING (KEEPING & FAILING)

    /*
    Keep part of the promise.
    */
    PROMISE.keep = function(name, data){
      if (GOT[name] !== undefined){
        throw new Error('"'+name+'" can only be kept once on promise.');
      }
      if (SLOTS[name] === undefined) {
        throw new Error('"'+name+'" is not promised.');
      }
      if (!FAILURE && !SUCCESS){
        if (data === undefined) {
          data = null;
        }
        SLOTS[name] = true;
        GOT[name] = data;
        var kept = Object.keys(SLOTS).every(function(item){
          return SLOTS[item];
        });
        if (kept) {
          SUCCESS = true;
          ALLBACKS.filter(function(obj){
            return obj.type === 'keep' || obj.type === 'resolve';
          }).forEach(function(obj){
            if (obj.type === 'keep') {
              obj.callback.call(obj.context, GOT);
            } else { // it's resolve
              obj.callback.call(obj.context);
            }
          });
          // these are no longer needed, allow GC
          ALLBACKS = undefined;
        }
      }
      return PROMISE;
    };

    /*
    Fail the promise for some reason.
    */
    PROMISE.fail = function(reason){
      if (!FAILURE && !SUCCESS){
        FAILURE = reason || 'Unspecified error.';
        ALLBACKS.filter(function(obj){
          return obj.type === 'fail' || obj.type === 'resolve';
        }).forEach(function(obj){
          if (obj.type === 'fail') {
            obj.callback.call(obj.context, FAILURE);
          } else { // it's resolve
            obj.callback.call(obj.context);
          }
        });
        // these are no longer needed, allow GC
        ALLBACKS = undefined;
      }
      return PROMISE;
    };

    // ########################################################################
    // CHAPTER 6 - CHAINING

    /*
    p1 = new Promise('foo', 'bar', 'baz')
    p2 = new Promise('foo', 'bar', 'buz', 'qux')

    p1.take(p2)

    p1      p2
    ===========
    foo <-- foo
    bar <-- bar
    baz     buz
            qux

    p1.take(p2, {'buz':'baz'})

    p1      p2
    ===========
    foo <-- foo
    bar <-- bar
    baz <-- buz
            qux

    p1.take(p2, {'qux':'bar','buz':'baz'})

    p1      p2
    ===========
    foo <-- foo
    bar <-- qux
    baz <-- buz
            bar

    */

    PROMISE.take = function(p2, map){
      p2.onfail(PROMISE.fail);
      p2.onkeep(function(got){
        var taken = {}, gotItems = Object.keys(got);

        // take any direct matches first
        gotItems.forEach(function(item){
          if (SLOTS.hasOwnProperty(item)) {
            taken[item] = got[item];
          }
        });

        // take matches via mapping, overwrites any direct matches
        if (map) {
          gotItems.forEach(function(item){
            if (map.hasOwnProperty(item) && SLOTS.hasOwnProperty(map[item])){
              taken[map[item]] = got[item];
            }
          });
        }

        Object.keys(taken).forEach(function(item){
          PROMISE.keep(item, taken[item]);
        });
      });
      return PROMISE;
    };
  };

  // ########################################################################
  // CONCLUSION

  // for browsers
  if (window) {
    window.Needs = Promise;
  }

  // for node
  if (exports) {
    exports.Needs = Promise;
  }

  // ########################################################################
  // IT'S OVER!

})();
