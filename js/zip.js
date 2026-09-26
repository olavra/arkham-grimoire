/* A minimal ZIP writer, enough to hand the browser one archive of the icon set.

   The page has no build step and no dependencies, and a zip is a handful of
   fixed-width records around the file bytes, so it is written here rather than
   pulling in a library. Deflate comes from CompressionStream, which every
   browser that ships `deflate-raw` has; where it is missing the entries are
   stored uncompressed, which is a bigger download but a valid archive either
   way.

   No ZIP64: the icon set is a few megabytes, and every field below is the
   32-bit one. A caller zipping gigabytes would need more than this. */
(function (global) {
  'use strict';

  /* Standard CRC-32 (polynomial 0xEDB88320), which is what a zip entry stores. */
  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  var utf8 = new TextEncoder();

  /* Zip keeps mtime as the 1980-based MS-DOS pair, two seconds of resolution. */
  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
  }
  function dosDate(d) {
    var y = d.getFullYear() - 1980;
    if (y < 0) y = 0;
    return ((y << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }

  function writer(n) {
    var buf = new Uint8Array(n);
    var view = new DataView(buf.buffer);
    var at = 0;
    return {
      bytes: buf,
      u16: function (v) { view.setUint16(at, v, true); at += 2; },
      u32: function (v) { view.setUint32(at, v >>> 0, true); at += 4; },
      raw: function (b) { buf.set(b, at); at += b.length; }
    };
  }

  var DEFLATED = 8, STORED = 0;

  var canDeflate = (function () {
    if (typeof CompressionStream !== 'function') return false;
    try { new CompressionStream('deflate-raw'); return true; }
    catch (e) { return false; }   // Safari had CompressionStream before deflate-raw
  })();

  function deflate(bytes) {
    var cs = new CompressionStream('deflate-raw');
    /* A one-chunk stream in, the whole compressed body out. */
    var stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  /* files: [{ name, bytes }] — `name` is the path inside the archive, with
     forward slashes. onProgress(done, total) runs as each entry is compressed.
     Resolves to a Blob ready for a download link. */
  function create(files, onProgress) {
    var parts = [];       // local headers and bodies, in order
    var central = [];     // one directory record per entry, written at the end
    var offset = 0;       // where the next local header starts
    var stamp = new Date();
    var time = dosTime(stamp), date = dosDate(stamp);
    var done = 0;

    function entry(file) {
      var name = utf8.encode(file.name);
      var body = file.bytes;
      var crc = crc32(body);

      var packed = canDeflate ? deflate(body) : Promise.resolve(null);

      return packed.catch(function () { return null; }).then(function (z) {
        /* Deflate can come out longer than the source on tiny or already dense
           files; store those rather than pay for the attempt. */
        var method = (z && z.length < body.length) ? DEFLATED : STORED;
        var data = method === DEFLATED ? z : body;

        var head = writer(30 + name.length);
        head.u32(0x04034B50);       // local file header
        head.u16(20);               // version needed: 2.0, deflate
        head.u16(0x0800);           // flags: the name below is UTF-8
        head.u16(method);
        head.u16(time);
        head.u16(date);
        head.u32(crc);
        head.u32(data.length);
        head.u32(body.length);
        head.u16(name.length);
        head.u16(0);                // no extra field
        head.raw(name);

        parts.push(head.bytes, data);

        var dir = writer(46 + name.length);
        dir.u32(0x02014B50);        // central directory header
        dir.u16(20);                // version made by
        dir.u16(20);                // version needed
        dir.u16(0x0800);
        dir.u16(method);
        dir.u16(time);
        dir.u16(date);
        dir.u32(crc);
        dir.u32(data.length);
        dir.u32(body.length);
        dir.u16(name.length);
        dir.u16(0);                 // extra
        dir.u16(0);                 // comment
        dir.u16(0);                 // disk number
        dir.u16(0);                 // internal attributes
        dir.u32(0);                 // external attributes
        dir.u32(offset);            // where its local header sits
        dir.raw(name);
        central.push(dir.bytes);

        offset += head.bytes.length + data.length;
        done++;
        if (onProgress) onProgress(done, files.length);
      });
    }

    /* One entry at a time: 478 concurrent CompressionStreams is a lot of
       allocation for no gain, and the offsets have to be assigned in order. */
    var chain = Promise.resolve();
    files.forEach(function (f) { chain = chain.then(function () { return entry(f); }); });

    return chain.then(function () {
      var dirStart = offset;
      var dirSize = central.reduce(function (n, b) { return n + b.length; }, 0);

      var end = writer(22);
      end.u32(0x06054B50);          // end of central directory
      end.u16(0);                   // this disk
      end.u16(0);                   // disk the directory starts on
      end.u16(central.length);      // entries on this disk
      end.u16(central.length);      // entries total
      end.u32(dirSize);
      end.u32(dirStart);
      end.u16(0);                   // no archive comment

      return new Blob(parts.concat(central, [end.bytes]), { type: 'application/zip' });
    });
  }

  global.Zip = { create: create, crc32: crc32, deflates: canDeflate };
})(window);
