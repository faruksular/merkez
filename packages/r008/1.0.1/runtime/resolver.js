(function (shared) {
  'use strict';

  var context = shared.FilmPlugins.context();
  var URLCtor = shared.URL;
  var BASE = 'https://www.diziyou.one';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  var SITE_HOSTS = { 'www.diziyou.one': true, 'diziyou.one': true };

  function error(stage, message) {
    var e = new Error('Diziyou: ' + message);
    e.stage = stage;
    return e;
  }

  function decodeEntities(value) {
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, function (all, entity) {
      var n;
      if (entity.charAt(0) === '#') {
        n = entity.charAt(1).toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (n >= 0 && n <= 65535) return String.fromCharCode(n);
        return all;
      }
      return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[entity.toLowerCase()] || all;
    });
  }

  function attributes(tag) {
    var result = {};
    var re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    var match;
    while ((match = re.exec(tag || ''))) result[match[1].toLowerCase()] = decodeEntities(match[2] || match[3] || match[4] || '');
    return result;
  }

  function isSiteUrl(value, page) {
    try {
      var u = new URLCtor(value, page || BASE + '/');
      return u.protocol === 'https:' && !!SITE_HOSTS[u.hostname] && !u.username && !u.password;
    } catch (ignore) {
      return false;
    }
  }

  function absolute(value, page) {
    try {
      var u = new URLCtor(decodeEntities(value), page || BASE + '/');
      return isSiteUrl(u.href, page) ? u.href : '';
    } catch (ignore) {
      return '';
    }
  }

  function findEpisodeFromSeries(html, seriesUrl, season, episode) {
    var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = re.exec(html || ''))) {
      var attr = attributes(match[1]);
      var body = match[2];
      if (!/class=["'][^"']*\bbolumust\b/i.test(body)) continue;
      var url = absolute(attr.href || '', seriesUrl);
      if (!url) continue;
      var heading = /<div\b[^>]*class=["'][^"']*\bbaslik\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(body);
      var headingText = heading ? heading[1].replace(/<[^>]*>/g, ' ') : '';
      var s = /(\d+)\.\s*Sezon/i.exec(headingText);
      var e = /(\d+)\.\s*Bölüm/i.exec(headingText);
      if ((!s || !e)) {
        var slug = /-(\d+)-sezon-(\d+)-bolum/i.exec(url);
        if (slug) { s = s || [slug[0], slug[1]]; e = e || [slug[0], slug[2]]; }
      }
      if (s && e && Number(s[1]) === Number(season) && Number(e[1]) === Number(episode)) return url;
    }
    return '';
  }

  function findPlayerFrame(html, episodeUrl) {
    var re = /<iframe\b[^>]*>/gi;
    var match;
    while ((match = re.exec(html || ''))) {
      var attr = attributes(match[0]);
      if (attr.id !== 'diziyouPlayer') continue;
      var url = absolute(attr.src || attr['data-src'] || attr['data-frame-src'] || '', episodeUrl);
      if (!url) throw error('embed', 'Diziyou oynatıcı iframe adresi geçersiz.');
      var page = new URLCtor(episodeUrl);
      var frame = new URLCtor(url);
      if (frame.hostname !== page.hostname) throw error('policy', 'Oynatıcı iframe farklı bir alan adına yöneliyor.');
      var id = /\/([0-9]+)\.html$/i.exec(frame.pathname);
      if (!id) throw error('decode', 'Oynatıcı URL içinde video numarası bulunamadı.');
      return { url: url, id: id[1] };
    }
    throw error('embed', 'DiziyouPlayer iframe bulunamadı.');
  }

  function playerOptions(html) {
    var flags = { turkceAltyazili: false, ingilizceAltyazili: false, turkceDublaj: false };
    var re = /<span\b[^>]*>/gi;
    var match;
    while ((match = re.exec(html || ''))) {
      var attr = attributes(match[0]);
      var classes = String(attr['class'] || '').split(/\s+/);
      if (classes.indexOf('diziyouOption') === -1) continue;
      if (attr.id === 'turkceAltyazili') flags.turkceAltyazili = true;
      if (attr.id === 'ingilizceAltyazili') flags.ingilizceAltyazili = true;
      if (attr.id === 'turkceDublaj') flags.turkceDublaj = true;
    }
    return flags;
  }

  function storageBase(episodeUrl) {
    var host = new URLCtor(episodeUrl).hostname.replace(/^www\./, '');
    if (host !== 'diziyou.one') throw error('policy', 'Bilinmeyen Diziyou ana sunucusu.');
    return 'https://storage.' + host;
  }

  function makeHeaders(referer) {
    return {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Referer': referer,
      'Accept-Language': 'tr-TR,tr;q=0.9'
    };
  }

  function Resolver(log, now) {
    this.log = typeof log === 'function' ? log : function () {};
    this.now = typeof now === 'function' ? now : Date.now;
    this.generation = 0;
    this.clients = [];
  }

  Resolver.prototype.cancel = function () {
    this.generation++;
    this.clients.splice(0).forEach(function (client) {
      try { client.cancel(); } catch (ignore) {}
    });
  };

  Resolver.prototype.get = function (url, referer, deadline, stage, token) {
    var self = this;
    if (!isSiteUrl(url) && !/^https:\/\/storage\.diziyou\.one\//i.test(url)) return Promise.reject(error('policy', 'İstek adresi izin verilen Diziyou alan adında değil.'));
    if (token !== this.generation) {
      var cancelled = error('cancel', 'İşlem iptal edildi.');
      cancelled.cancelled = true;
      return Promise.reject(cancelled);
    }
    if (this.now() >= deadline) return Promise.reject(error('timeout', 'Kaynak hazırlama süresi doldu.'));
    var client = context.createClient();
    this.clients.push(client);
    function release() {
      var index = self.clients.indexOf(client);
      if (index !== -1) self.clients.splice(index, 1);
    }
    return client.get(url, referer || BASE + '/', makeHeaders(referer || BASE + '/'), {
      deadline: deadline,
      timeoutMs: Math.min(25000, Math.max(1, deadline - this.now()))
    }).then(function (response) {
      release();
      if (token !== self.generation) {
        var e = error('cancel', 'İşlem iptal edildi.');
        e.cancelled = true;
        throw e;
      }
      if (self.now() >= deadline) throw error('timeout', 'Kaynak hazırlama süresi doldu.');
      return response;
    }, function (e) {
      release();
      if (token !== self.generation) {
        var cancelled = error('cancel', 'İşlem iptal edildi.');
        cancelled.cancelled = true;
        throw cancelled;
      }
      e.requestStage = stage;
      throw e;
    });
  };

  Resolver.prototype.resolve = function (content, deadline, notify) {
    var self = this;
    this.cancel();
    var token = this.generation;
    var sources = [];
    var options = [];
    var pageUrl = content && content.pageUrl || '';
    var referer = content && content.seriesPageUrl || BASE + '/';
    var season = content && content.episode && Number(content.episode.season) || 0;
    var episode = content && content.episode && Number(content.episode.number) || 0;

    if (!pageUrl || !isSiteUrl(pageUrl)) return Promise.reject(error('page', 'Geçersiz bölüm adresi.'));
    if (self.now() >= deadline) return Promise.reject(error('timeout', 'Kaynak hazırlama süresi doldu.'));

    function publish() {
      if (typeof notify === 'function') notify(sources.slice());
    }

    function resolveEpisodeUrl() {
      if (content.type === 'episode' || /\.html(?:\?|$)/i.test(new URLCtor(pageUrl).pathname) || /\/bolum\//i.test(new URLCtor(pageUrl).pathname) || /-\d+-sezon-\d+-bolum/i.test(new URLCtor(pageUrl).pathname)) return Promise.resolve(pageUrl);
      if (!season || !episode) return Promise.reject(error('episode', 'Sezon ve bölüm numarası eksik.'));
      return self.get(pageUrl, referer, deadline, 'series', token).then(function (response) {
        var resolved = findEpisodeFromSeries(response.body, response.url || pageUrl, season, episode);
        if (!resolved) throw error('episode', 'İstenen sezon/bölüm bağlantısı bulunamadı.');
        return resolved;
      });
    }

    return resolveEpisodeUrl().then(function (episodePageUrl) {
      return self.get(episodePageUrl, referer, deadline, 'episode', token).then(function (episodeResponse) {
        var effectiveUrl = episodeResponse.url || episodePageUrl;
        if (!isSiteUrl(effectiveUrl)) throw error('policy', 'Bölüm sayfası izin verilmeyen adrese yönlendi.');
        var frame = findPlayerFrame(episodeResponse.body, effectiveUrl);
        var flags = playerOptions(episodeResponse.body);
        var base = storageBase(effectiveUrl);
        var refererHeader = new URLCtor(effectiveUrl).origin + '/';
        var subtitles = [];
        var variants = [];
        var playlistId = frame.id;
        var subtitleUrl;

        if (flags.turkceAltyazili || flags.ingilizceAltyazili) {
          variants.push({ id: 'sub', label: 'Türkçe/İngilizce altyazılı', url: base + '/episodes/' + playlistId + '/play.m3u8', lang: 'sub' });
        }
        if (flags.turkceDublaj) {
          variants.push({ id: 'dub', label: 'Türkçe dublaj', url: base + '/episodes/' + playlistId + '_tr/play.m3u8', lang: 'dub' });
        }
        if (flags.turkceAltyazili) {
          subtitleUrl = base + '/subtitles/' + playlistId + '/tr.vtt';
          subtitles.push({ id: 'diziyou-tr-' + playlistId, url: subtitleUrl, label: 'Türkçe', language: 'tr', format: 'vtt', packageKey: context.key, referer: refererHeader });
        }
        if (flags.ingilizceAltyazili) {
          subtitleUrl = base + '/subtitles/' + playlistId + '/en.vtt';
          subtitles.push({ id: 'diziyou-en-' + playlistId, url: subtitleUrl, label: 'English', language: 'en', format: 'vtt', packageKey: context.key, referer: refererHeader });
        }
        if (!variants.length) throw error('options', 'Diziyou sayfasında desteklenen dublaj/altyazı seçeneği bulunamadı.');

        function checkVariant(index) {
          if (token !== self.generation) {
            var cancelled = error('cancel', 'İşlem iptal edildi.');
            cancelled.cancelled = true;
            throw cancelled;
          }
          if (index >= variants.length) return Promise.resolve();
          var variant = variants[index];
          var option = { sourceId: 'diziyou-' + playlistId + '-' + variant.id, label: variant.label, pageUrl: effectiveUrl, status: 'pending', stage: 'manifest', detail: '' };
          options.push(option);
          publish();
          return self.get(variant.url, refererHeader, deadline, 'manifest', token).then(function (manifest) {
            if (!/^\s*#EXTM3U/m.test(String(manifest.body || ''))) throw error('manifest', 'HLS oynatma listesi beklenen biçimde değil.');
            var dual = /#EXT-X-MEDIA:[^\r\n]*TYPE=AUDIO[^\r\n]*LANGUAGE="(?:tr|tur)"/i.test(manifest.body || '');
            sources.push({
              id: option.sourceId,
              label: variant.label + (dual ? ' · Çoklu ses' : ''),
              url: variant.url,
              type: 'hls',
              referer: refererHeader,
              packageKey: context.key,
              preferredEngine: 'html5',
              subtitles: variant.lang === 'sub' ? subtitles : [],
              order: sources.length,
              languagePriority: variant.lang === 'dub' ? 0 : 1
            });
            option.status = 'ready';
            option.detail = 'HLS manifest doğrulandı';
          }).catch(function (e) {
            option.status = 'error';
            option.stage = e.stage || 'manifest';
            option.detail = shared.PlayerCore && shared.PlayerCore.safeMessage ? shared.PlayerCore.safeMessage(e.message) : String(e.message || e);
            self.log('Diziyou resolver ' + option.stage, e);
          }).then(function () {
            publish();
            return checkVariant(index + 1);
          });
        }

        return checkVariant(0).then(function () {
          if (!sources.length) {
            var e = error('empty', 'Diziyou için doğrulanmış HLS kaynağı bulunamadı.');
            e.sourceOptions = options;
            throw e;
          }
          sources.options = options;
          publish();
          return sources;
        });
      });
    });
  };

  context.registerResolver({
    create: function (ctx, log, now) {
      return new Resolver(log, now);
    }
  });
})(window);
