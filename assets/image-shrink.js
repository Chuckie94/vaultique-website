/* =====================================================================
   PHOTO SHRINKING, BEFORE A PHOTO LEAVES THE PHONE

   Used by the admin for every upload, and by the chat window (loaded
   only when a customer picks a photo) for photos customers send.

   THE COMPLAINT THIS ANSWERS: "the website loads slowly, images,
   including hero, load so late."

   WHY. Every photo went up exactly as the phone took it: 3 to 8 MB and
   4000 pixels wide. The storefront then asked every visitor to download
   that, on mobile data, before the hero could appear. No screen the shop
   is shown on is 4000 pixels wide.

   WHAT THIS DOES. A photo is redrawn at no more than MAX pixels on its
   long side and saved as a JPEG at QUALITY. A typical phone photo comes
   out at 200-400 KB, which is a tenth or less of what it was, and looks
   the same on screen.

   WHAT IT LEAVES ALONE. Anything it cannot improve on is uploaded as it
   was: a picture already small, a GIF or SVG, a PNG with see-through
   parts (a logo, usually, where JPEG would paint the background black),
   a format this browser cannot draw, and any result that came out bigger
   than the original. Shrinking is a saving, never a condition of an
   upload working.
   ===================================================================== */
(function () {
  'use strict';

  var MAX = 1800;               // long side, in pixels
  var QUALITY = 0.8;
  var SMALL = 300 * 1024;       // below this, and within MAX, leave it be

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var im = new Image();
      im.onload = function () { resolve({ im: im, url: url }); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('undrawable')); };
      im.src = url;
    });
  }

  function hasSeeThrough(ctx, w, h) {
    try {
      var d = ctx.getImageData(0, 0, w, h).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
    } catch (e) { return true; }   // cannot tell: treat as see-through, leave it
    return false;
  }

  /* Resolves with a smaller JPEG Blob, or null when the original should
     be kept. Never rejects. */
  function shrink(blob, opts) {
    var max = (opts && opts.max) || MAX;
    if (blob && blob._vbpShrunk) return Promise.resolve(null);   // already done once
    var type = String((blob && blob.type) || '').toLowerCase();
    if (!/^image\/(jpeg|jpg|pjpeg|webp|png)$/.test(type)) return Promise.resolve(null);
    if (typeof document === 'undefined' || !window.URL || !URL.createObjectURL) return Promise.resolve(null);

    return loadImage(blob).then(function (got) {
      var im = got.im;
      var w = im.naturalWidth, h = im.naturalHeight;
      if (!w || !h) { URL.revokeObjectURL(got.url); return null; }
      var big = Math.max(w, h);
      if (big <= max && blob.size <= SMALL) { URL.revokeObjectURL(got.url); return null; }

      var k = big > max ? max / big : 1;
      var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(im, 0, 0, cw, ch);
      URL.revokeObjectURL(got.url);

      if (type === 'image/png' && hasSeeThrough(ctx, cw, ch)) return null;

      return new Promise(function (resolve) {
        c.toBlob(function (out) {
          if (out && out.size && out.size < blob.size) { out._vbpShrunk = true; resolve(out); }
          else resolve(null);
        }, 'image/jpeg', QUALITY);
      });
    }).catch(function () { return null; });
  }

  window.VBP_SHRINK = { shrink: shrink, MAX: MAX, QUALITY: QUALITY };
}());
