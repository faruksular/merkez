(function (shared) {
  'use strict';

  var context = shared.FilmPlugins.context();
  var U = shared.CatalogUtils;
  var URLCtor = shared.URL;
  var BASE = context.site.base || 'https://www.diziyou.one';
  var SITE_ID = 'p008';
  var PREFIX = 'p008:';
  var CATEGORY_DATA = [
    { id: 'all-series', name: 'Dizi Arşivi', path: '/dizi-arsivi/page/SAYFA/' },
    { id: 'family', name: 'Aile', path: '/dizi-arsivi/page/SAYFA/?tur=Aile' },
    { id: 'action', name: 'Aksiyon', path: '/dizi-arsivi/page/SAYFA/?tur=Aksiyon' },
    { id: 'animation', name: 'Animasyon', path: '/dizi-arsivi/page/SAYFA/?tur=Animasyon' },
    { id: 'documentary', name: 'Belgesel', path: '/dizi-arsivi/page/SAYFA/?tur=Belgesel' },
    { id: 'science-fiction', name: 'Bilim Kurgu', path: '/dizi-arsivi/page/SAYFA/?tur=Bilim%20Kurgu' },
    { id: 'drama', name: 'Dram', path: '/dizi-arsivi/page/SAYFA/?tur=Dram' },
    { id: 'fantasy', name: 'Fantazi', path: '/dizi-arsivi/page/SAYFA/?tur=Fantazi' },
    { id: 'thriller', name: 'Gerilim', path: '/dizi-arsivi/page/SAYFA/?tur=Gerilim' },
    { id: 'mystery', name: 'Gizem', path: '/dizi-arsivi/page/SAYFA/?tur=Gizem' },
    { id: 'comedy', name: 'Komedi', path: '/dizi-arsivi/page/SAYFA/?tur=Komedi' },
    { id: 'horror', name: 'Korku', path: '/dizi-arsivi/page/SAYFA/?tur=Korku' },
    { id: 'adventure', name: 'Macera', path: '/dizi-arsivi/page/SAYFA/?tur=Macera' },
    { id: 'political', name: 'Politik', path: '/dizi-arsivi/page/SAYFA/?tur=Politik' },
    { id: 'war', name: 'Savaş', path: '/dizi-arsivi/page/SAYFA/?tur=Savaş' },
    { id: 'crime', name: 'Suç', path: '/dizi-arsivi/page/SAYFA/?tur=Suç' },
    { id: 'western', name: 'Vahşi Batı', path: '/dizi-arsivi/page/SAYFA/?tur=Vahşi Batı' }
  ];

  function decodeEntities(value) {
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, function (all, entity) {
      var number;
      if (entity.charAt(0) === '#') {
        number = entity.charAt(1).toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (number >= 0 && number <= 1114111 && String.fromCodePoint) return String.fromCodePoint(number);
        if (number >= 0 && number <= 65535) return String.fromCharCode(number);
        return all;
      }
      return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[entity.toLowerCase()] || all;
    });
  }

  function clean(value) {
    var result = decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    return U && U.clean ? U.clean(result) : result;
  }

  function attributes(tag) {
    var result = {};
    var re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    var match;
    while ((match = re.exec(tag || ''))) {
      result[match[1].toLowerCase()] = decodeEntities(match[2] || match[3] || match[4] || '');
    }
    return result;
  }

  function safeUrl(value, page) {
    var resolved;
    var parsed;
    if (!value) return '';
    try {
      resolved = U && U.url ? U.url(value, page || BASE + '/') : new URLCtor(value, page || BASE + '/').href;
      parsed = new URLCtor(resolved);
      if (parsed.protocol !== 'https:') return '';
      if (parsed.hostname !== 'www.diziyou.one' && parsed.hostname !== 'diziyou.one') return '';
      if (parsed.username || parsed.password) return '';
      parsed.hash = '';
      return parsed.href;
    } catch (ignore) {
      return '';
    }
  }

  function slugFromUrl(value) {
    try {
      var path = new URLCtor(value).pathname.replace(/\/$/, '');
      return path.split('/').pop() || 'home';
    } catch (ignore) {
      return 'unknown';
    }
  }

  function makeCard(url, title, poster, year, score) {
    var normalized = safeUrl(url, BASE + '/');
    if (!normalized || !title) return null;
    return {
      contentId: PREFIX + 'series:' + encodeURIComponent(new URLCtor(normalized).pathname),
      providerId: SITE_ID,
      type: 'series',
      pageUrl: normalized,
      title: clean(title),
      poster: poster ? safeUrl(poster, normalized) || '' : '',
      year: year ? Number(year) : 0,
      imdb: score ? Number(score) : 0,
      sources: [],
      subtitles: []
    };
  }

  function anchors(html) {
    var result = [];
    var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = re.exec(html || ''))) {
      var attr = attributes(match[1]);
      result.push({ href: attr.href || '', title: attr.title || clean(match[2]), body: match[2], attrs: attr });
    }
    return result;
  }

  function imageFrom(html, page) {
    var match = /<img\b([^>]*)>/i.exec(html || '');
    if (!match) return '';
    var attr = attributes(match[1]);
    return safeUrl(attr['data-src'] || attr['data-lazy-src'] || attr.src || '', page);
  }

  function cardsFromBlocks(html, page) {
    var output = [];
    var seen = {};
    var blocks = String(html || '').match(/<div\b[^>]*class=["'][^"']*\bsingle-item\b[^"']*["'][^>]*>[\s\S]*?(?=<div\b[^>]*class=["'][^"']*\bsingle-item\b|$)/gi) || [];
    blocks.forEach(function (block) {
      var list = anchors(block);
      var anchor = null;
      var i;
      for (i = 0; i < list.length; i++) {
        if (list[i].href && list[i].title) { anchor = list[i]; break; }
      }
      if (!anchor) return;
      var url = safeUrl(anchor.href, page);
      if (!url || seen[url]) return;
      var poster = imageFrom(block, page);
      var scoreMatch = /id=["']imdbp["'][^>]*>\s*\(?\s*([\d.]+)/i.exec(block);
      var yearMatch = /(?:Yapım Yılı|Yapim Yili|Yıl|Year)[^\d]{0,30}((?:19|20)\d{2})/i.exec(block);
      var card = makeCard(url, anchor.title, poster, yearMatch && yearMatch[1], scoreMatch && scoreMatch[1]);
      if (card) { seen[url] = true; output.push(card); }
    });
    return output;
  }

  function cardsFromSearch(html, page) {
    var output = [];
    var seen = {};
    var blocks = String(html || '').match(/<div[^>]*id=["']searchelement["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi) || [];
    blocks.forEach(function (block) {
      var inner = /<div[^>]*id=["']searchelement["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(block);
      var body = inner ? inner[1] : block;
      var hrefMatch = /<a[^>]*href=["']([^"']+)["']/i.exec(body);
      if (!hrefMatch) return;
      var url = safeUrl(hrefMatch[1], page);
      var titleMatch = /<a[^>]*>([^<]+)<\/a>/i.exec(body);
      var title = titleMatch ? clean(titleMatch[1]) : '';
      if (!title) {
        var titleAttr = /<a\b([^>]*)>/i.exec(body);
        title = titleAttr ? (attributes(titleAttr[1]).title || '') : '';
      }
      var yearMatch = /<div[^>]*id=["']search-cat-year["'][^>]*>\s*(\d{4})\s*<\/div>/i.exec(body);
      var posterMatch = /<img[^>]*src=["']([^"']+)["']/i.exec(body);
      var poster = posterMatch ? safeUrl(posterMatch[1], page) : imageFrom(body, page);
      if (!url || !title || seen[url]) return;
      var card = makeCard(url, title, poster, yearMatch && yearMatch[1], 0);
      if (card) { seen[url] = true; output.push(card); }
    });
    var categoryBlocks = String(html || '').match(/<div\b[^>]*id=["']categorytitle["'][^>]*>([\s\S]*?)<\/div>/gi) || [];
    categoryBlocks.forEach(function (block) {
      anchors(block).forEach(function (a) {
        var url = safeUrl(a.href, page);
        var title = a.title || clean(a.body);
        if (!url || !title || seen[url]) return;
        var card = makeCard(url, title, '', 0, 0);
        if (card) { seen[url] = true; output.push(card); }
      });
    });
    if (!output.length) return cardsFromBlocks(html, page);
    return output;
  }

  function nextPage(html, currentUrl) {
    var match = /<a\b([^>]*(?:class=["'][^"']*(?:\bnext\b|nextpostslink)[^"']*["']|rel=["']next["'])[^>]*)>/i.exec(html || '');
    if (!match) return null;
    var attr = attributes(match[1]);
    var next = safeUrl(attr.href, currentUrl);
    if (!next || next === currentUrl) return null;
    try {
      var current = new URLCtor(currentUrl);
      var target = new URLCtor(next);
      if (!target.search && current.search) target.search = current.search;
      next = target.href;
    } catch (ignore) {}
    return next !== currentUrl ? { kind: 'url', url: next } : null;
  }

  function pageNumber(url) {
    var match = /\/dizi-arsivi\/page\/(\d+)\//.exec(url || '');
    return match ? Number(match[1]) : 1;
  }

  function categoryUrl(id, page) {
    var category = CATEGORY_DATA.filter(function (item) { return item.id === id; })[0] || CATEGORY_DATA[0];
    return BASE + category.path.replace('SAYFA', String(page || 1));
  }

  function seasonEpisodeFrom(html, url) {
    var heading = /<div\b[^>]*class=["'][^"']*\bbaslik\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html || '');
    var name = /<div\b[^>]*class=["'][^"']*\bbolumismi\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html || '');
    var headingText = heading ? clean(heading[1]) : '';
    var season = /(\d+)\.\s*Sezon/i.exec(headingText);
    var episode = /(\d+)\.\s*Bölüm/i.exec(headingText);
    if ((!season || !episode) && url) {
      var slug = /-(\d+)-sezon-(\d+)-bolum/i.exec(url);
      if (slug) { season = season || [slug[0], slug[1]]; episode = episode || [slug[0], slug[2]]; }
    }
    return {
      season: season ? Number(season[1]) : 0,
      episode: episode ? Number(episode[1]) : 0,
      name: name ? clean(name[1]).replace(/^\(|\)$/g, '') : headingText
    };
  }

  function episodeLinks(html, seriesUrl, seriesTitle, poster) {
    var result = [];
    var seen = {};
    var list = anchors(html);
    list.forEach(function (a, index) {
      if (!a.href || !/class=["'][^"']*\bbolumust\b/i.test(a.body)) return;
      var url = safeUrl(a.href, seriesUrl);
      if (!url || seen[url]) return;
      var info = seasonEpisodeFrom(a.body, url);
      if (!info.season || !info.episode) return;
      seen[url] = true;
      result.push({
        contentId: PREFIX + 'episode:' + encodeURIComponent(slugFromUrl(url)),
        providerId: SITE_ID,
        type: 'episode',
        pageUrl: url,
        title: (seriesTitle || 'Diziyou') + ' · ' + info.season + '×' + info.episode,
        episodeTitle: info.name || (info.season + '. Sezon ' + info.episode + '. Bölüm'),
        seriesTitle: seriesTitle || '',
        seriesPageUrl: seriesUrl,
        poster: poster || '',
        episode: { season: info.season, number: info.episode },
        sources: [],
        subtitles: []
      });
    });
    result.sort(function (a, b) {
      return a.episode.season - b.episode.season || a.episode.number - b.episode.number;
    });
    return result;
  }

  function metaContent(html, key) {
    var tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
    var i;
    for (i = 0; i < tags.length; i++) {
      var attr = attributes(tags[i]);
      if ((attr.property || attr.name || '').toLowerCase() === key.toLowerCase()) return decodeEntities(attr.content || '');
    }
    return '';
  }

  function detailData(html, input) {
    var page = safeUrl(input.pageUrl, BASE + '/');
    if (!page) throw new Error('Diziyou: Geçersiz dizi adresi.');
    var titleMatch = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html || '');
    var title = clean(metaContent(html, 'og:title') || (titleMatch && titleMatch[1]) || '');
    title = title.replace(/\s*[|–-]\s*Diziyou.*$/i, '').replace(/\s+izle$/i, '');
    if (!title) title = clean((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html || '') || [])[1] || '');
    if (!title) throw new Error('Diziyou: Dizi başlığı bulunamadı.');
    var poster = safeUrl(metaContent(html, 'og:image'), page) || '';
    var description = clean(metaContent(html, 'og:description') || metaContent(html, 'description'));
    var yearMatch = /(?:Yapım Yılı|Yapim Yili|İlk Yayın|Release)[^\d]{0,40}((?:19|20)\d{2})/i.exec(html || '');
    var imdbMatch = /(?:IMDb|imdbp)[^\d]{0,20}(\d(?:[.,]\d)?)/i.exec(html || '');
    var episodes = episodeLinks(html, page, title, poster);
    var seasons = [];
    episodes.forEach(function (item) {
      if (seasons.indexOf(item.episode.season) === -1) seasons.push(item.episode.season);
    });
    seasons.sort(function (a, b) { return a - b; });
    if (!episodes.length) throw new Error('Diziyou: Bölüm bağlantıları bulunamadı veya sezon/bölüm bilgisi tanınmadı.');
    var result = {
      contentId: PREFIX + 'series:' + encodeURIComponent(new URLCtor(page).pathname),
      providerId: SITE_ID,
      type: 'series',
      pageUrl: page,
      title: title,
      poster: poster,
      description: description,
      synopsis: description,
      year: yearMatch ? Number(yearMatch[1]) : 0,
      imdb: imdbMatch ? Number(imdbMatch[1].replace(',', '.')) : 0,
      genres: [],
      cast: [],
      seasons: seasons,
      episodes: episodes,
      sources: [],
      subtitles: [],
      next: null
    };
    if (input.selectedEpisodePageUrl) result.selectedEpisodePageUrl = safeUrl(input.selectedEpisodePageUrl, page);
    return result;
  }

  function parseList(body, page, search) {
    var html = String(body || '');
    var cards = search ? cardsFromSearch(html, page) : cardsFromBlocks(html, page);
    if (!search && !cards.length && !/dizi-arsivi|single-item/i.test(html)) {
      throw new Error('Diziyou: Katalog HTML yapısı tanınmadı.');
    }
    if (search && !cards.length && !/arama|search|sonuç|sonuc/i.test(html)) {
      throw new Error('Diziyou: Arama HTML yapısı tanınmadı.');
    }
    return { cards: cards, next: nextPage(html, page) };
  }

  function Provider(cache) {
    shared.CatalogClient.call(this, cache, context.createClient(), {
      base: BASE,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Referer': BASE + '/'
      }
    });
  }
  Provider.prototype = Object.create(shared.CatalogClient.prototype);
  Provider.prototype.constructor = Provider;
  Provider.prototype.fetchPage = function (url, parser, force, scope) {
    var safe = safeUrl(url, BASE + '/');
    if (!safe) return Promise.reject(new Error('Diziyou: Site dışı katalog adresi engellendi.'));
    return this.request(safe, null, parser, force, 'p008-v1-' + scope);
  };
  Provider.prototype.home = function (force) {
    var url = categoryUrl('all-series', 1);
    return this.fetchPage(url, function (body) {
      var parsed = parseList(body, url, false);
      return {
        hero: parsed.cards[0] || null,
        series: parsed.cards,
        movies: [],
        genres: [],
        links: { 'new': url }
      };
    }, force, 'home');
  };
  Provider.prototype.options = function () {
    return Promise.resolve({
      genres: CATEGORY_DATA.slice(1).map(function (item) { return { value: item.name, label: item.name }; }),
      order: [{ value: 'site', label: 'Site sırası' }]
    });
  };
  Provider.prototype.list = function (query, cursor, force) {
    query = query || {};
    if (query.type === 'movie') return Promise.resolve({ cards: [], next: null });
    var selectedGenre = query.filters && (query.filters.genre || query.filters.genres) || query.genre || '';
    var category = CATEGORY_DATA.filter(function (item) {
      return item.name.toLowerCase() === String(selectedGenre).toLowerCase() || item.id === selectedGenre;
    })[0] || CATEGORY_DATA[0];
    var url = safeUrl(cursor && cursor.url || query.url || categoryUrl(category.id, 1), BASE + '/');
    if (!url) return Promise.reject(new Error('Diziyou: Geçersiz katalog bağlantısı.'));
    var parsed = new URLCtor(url);
    if (!/^\/dizi-arsivi\/page\/\d+\/$/.test(parsed.pathname)) return Promise.reject(new Error('Diziyou: Desteklenmeyen katalog yolu.'));
    return this.fetchPage(url, function (body) { return parseList(body, url, false); }, force, 'list');
  };

  Provider.prototype.search = function (query, force, cursor) {
    var q = clean(query);
    if (!q) return Promise.resolve({ cards: [], next: null });
    var url = cursor && cursor.url || BASE + '/?s=' + encodeURIComponent(q);
    return this.fetchPage(url, function (body) { return parseList(body, url, true); }, force, 'search');
  };
  Provider.prototype.detail = function (input, force) {
    input = input || {};
    var page = safeUrl(input.pageUrl, BASE + '/');
    if (!page) return Promise.reject(new Error('Diziyou: Dizi sayfası bulunamadı.'));
    return this.fetchPage(page, function (body) { return detailData(body, input); }, force, 'detail');
  };
  Provider.prototype.identity = Provider.prototype.detail;

  var Resolver = function (log, now) {
    this.delegate = context.createResolver('r008', log, now);
  };
  Resolver.prototype.cancel = function () { this.delegate.cancel(); };
  Resolver.prototype.resolve = function (content, deadline, notify, hints) {
    return this.delegate.resolve(content, deadline, notify, hints);
  };

  shared.SiteRegistry.register({
    id: SITE_ID,
    name: 'Diziyou',
    base: BASE,
    mark: 'Diziyou',
    subtitle: 'Türkçe dizi kaynağı',
    prefix: PREFIX,
    storagePrefix: 'site.p008.',
    contentTypes: ['series'],
    supportsSeriesLanguage: true,
    collectionKeys: ['new'],
    Provider: Provider,
    Resolver: Resolver,
    ui: {
      seriesRail: 'Diziyou Dizi Arşivi',
      filterHint: 'Diziyou türünü seç',
      filterSummary: 'Diziyou',
      defaultOrder: 'site'
    },
    collectionQuery: function (type, key, links) {
      return { type: 'series', url: links && links[key] || categoryUrl('all-series', 1) };
    },
    filterFields: function () { return ['genres', 'order']; }
  });
})(window);
