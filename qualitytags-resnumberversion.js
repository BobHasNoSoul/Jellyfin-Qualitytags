(function () {
    const overlayClass = 'quality-overlay-label';
    const CACHE_VERSION = 'v9';
    const CACHE_KEY = `qualityOverlayCache-${CACHE_VERSION}`;
    
    const IGNORE_SELECTORS = [
        'html.preload.layout-desktop body.force-scroll.libraryDocument div#reactRoot div.mainAnimatedPages.skinBody div#itemDetailPage.page.libraryPage.itemDetailPage.noSecondaryNavPage.selfBackdropPage.mainAnimatedPage div.detailPageWrapperContainer div.detailPageSecondaryContainer.padded-bottom-page div.detailPageContent div#castCollapsible.verticalSection.detailVerticalSection.emby-scroller-container a.cardImageContainer',
        'html.preload.layout-desktop body.force-scroll.libraryDocument.withSectionTabs.mouseIdle div#reactRoot div.mainAnimatedPages.skinBody div#indexPage.page.homePage.libraryPage.allLibraryPage.backdropPage.pageWithAbsoluteTabs.withTabs.mainAnimatedPage div#homeTab.tabContent.pageTabContent.is-active div.sections.homeSectionsContainer div.verticalSection.MyMedia.emby-scroller-container a.cardImageContainer'
    ];
    
    const MEDIA_TYPES = new Set([
        'Movie','Episode','Series','Season',
        'MusicAlbum','AudioBook','Book'
    ]);
    
    let qualityOverlayCache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    let seenItems = new Set();
    let pendingRequests = new Set();
    let errorCount = 0;
    let currentDelay = 1000;

    // unified pastel palette for all tags
    const qualityColors = {
        '720p':  'rgba(255, 165,   0, 0.85)',  // pastel orange
        '1080p': 'rgba(0,   204, 204, 0.85)',  // pastel teal
        '1440p': 'rgba(0,   150, 136, 0.85)',  // deep pastel teal
        'SD':    'rgba(150, 150, 150, 0.85)',  // neutral grey
        'HD':    'rgba(0,   102, 204, 0.85)',  // pastel blue
        'UHD':   'rgba(0,   153,  51, 0.85)',  // pastel green
        // audio & other tags
        'MP3':   'rgba(255, 192, 203, 0.85)',  // pastel pink
        'FLAC':  'rgba(255, 218, 185, 0.85)',  // pastel peach
        'M4A':   'rgba(255, 255, 204, 0.85)',  // pastel yellow
        'Atmos': 'rgba(173, 216, 230, 0.85)',  // pastel light blue
        'EPUB':  'rgba(221, 160, 221, 0.85)',  // pastel lavender
        'PDF':   'rgba(152, 251, 152, 0.85)'   // pastel mint
    };

    const config = {
        MAX_CONCURRENT_REQUESTS: 9,
        BASE_DELAY: 1000,
        MAX_DELAY: 10000,
        VISIBLE_PRIORITY_DELAY: 200,
        CACHE_TTL: 7 * 24 * 60 * 60 * 1000,
        REQUEST_TIMEOUT: 5000
    };

    const visibilityObserver = new IntersectionObserver(handleIntersection, {
        rootMargin: '300px',
        threshold: 0.01
    });

    let navigationHandlerSetup = false;

    function getUserId() {
        try {
            return window.ApiClient?._serverInfo?.UserId || null;
        } catch {
            return null;
        }
    }

    function saveCache() {
        try {
            const now = Date.now();
            for (const [key, entry] of Object.entries(qualityOverlayCache)) {
                if (now - entry.timestamp > config.CACHE_TTL) {
                    delete qualityOverlayCache[key];
                }
            }
            localStorage.setItem(CACHE_KEY, JSON.stringify(qualityOverlayCache));
        } catch (e) {
            console.warn('Failed to save cache', e);
        }
    }

    function createLabel(label) {
        const badge = document.createElement('div');
        badge.textContent = label;
        badge.className = overlayClass;
        const key = label.split(' ')[0];  // matches our qualityColors keys
        badge.style.background = qualityColors[key] || qualityColors['SD'];
        badge.style.position = 'absolute';
        badge.style.top = '6px';
        badge.style.left = '6px';
        badge.style.color = 'white';
        badge.style.padding = '2px 6px';
        badge.style.fontSize = '12px';
        badge.style.fontWeight = 'bold';
        badge.style.borderRadius = '4px';
        badge.style.zIndex = '99';
        badge.style.pointerEvents = 'none';
        badge.style.userSelect = 'none';
        return badge;
    }

    function getQualityInfo(ms) {
        if (!ms) return null;
        const h = ms.Height || 0;
        let q = null;
        if (h >= 2160)      q = 'UHD';
        else if (h >= 1440) q = '1440p';
        else if (h >= 1080) q = '1080p';
        else if (h >= 720)  q = '720p';
        else if (h > 0)     q = 'SD';
        else return null;
        const range = (ms.VideoRange || 'SDR').toUpperCase();
        return { quality: q, range };
    }

    async function fetchFirstEpisode(userId, seriesId) {
        try {
            const episodeResponse = await ApiClient.ajax({
                type: "GET",
                url: ApiClient.getUrl("/Items", {
                    ParentId: seriesId,
                    IncludeItemTypes: "Episode",
                    Recursive: true,
                    SortBy: "PremiereDate",
                    SortOrder: "Ascending",
                    Limit: 1,
                    userId
                }),
                dataType: "json"
            });
            const episode = episodeResponse.Items?.[0];
            return episode?.Id ? episode : null;
        } catch {
            return null;
        }
    }

    async function fetchItemQuality(userId, itemId) {
        if (pendingRequests.has(itemId)) return null;
        pendingRequests.add(itemId);

        try {
            const item = await ApiClient.getItem(userId, itemId);
            if (!item || !MEDIA_TYPES.has(item.Type)) return null;

            let mediaSrc = item.MediaSources?.[0];

            if (item.Type === 'MusicAlbum') {
                const resp = await ApiClient.ajax({
                    type: 'GET',
                    url: ApiClient.getUrl('/Items', {
                        ParentId: item.Id,
                        IncludeItemTypes: 'Audio',
                        Limit: 1,
                        SortBy: 'TrackNumber',
                        SortOrder: 'Ascending',
                        userId
                    }),
                    dataType: 'json'
                });
                const track = resp.Items?.[0];
                if (track?.Id) {
                    const fullTrack = await ApiClient.getItem(userId, track.Id);
                    mediaSrc = fullTrack.MediaSources?.[0];
                }
            }

            let videoTag = '', audioTag = '', bookTag = '';

            if (['Movie','Episode','Series','Season'].includes(item.Type)) {
                const vs = mediaSrc?.MediaStreams?.find(s => s.Type === 'Video');
                const info = getQualityInfo(vs);
                if (info) videoTag = `${info.quality} ${info.range}`;
            }

            if (['AudioBook','Audio','MusicAlbum'].includes(item.Type)) {
                if (mediaSrc?.Container) audioTag = mediaSrc.Container.toUpperCase();
                const aud = mediaSrc?.MediaStreams?.find(s => s.Type === 'Audio');
                const layout = (aud?.ChannelLayout || '').toLowerCase();
                const codec  = (aud?.Codec || '').toLowerCase();
                if (layout.includes('atmos') || codec.includes('atmos')) {
                    audioTag += audioTag ? ' • Atmos' : 'Atmos';
                }
            }

            if (item.Type === 'Book') {
                const ext = (item.Path||'').split('.').pop().toLowerCase();
                if (['epub','pdf','mobi','azw3'].includes(ext)) bookTag = ext.toUpperCase();
                else if (item.Format) bookTag = item.Format.toUpperCase();
            }

            const parts = [];
            if (videoTag) parts.push(videoTag);
            if (audioTag) parts.push(audioTag);
            if (bookTag)  parts.push(bookTag);
            const final = parts.join(' • ');

            if (final) {
                qualityOverlayCache[itemId] = { quality: final, timestamp: Date.now() };
                saveCache();
                return final;
            }
            return null;
        } catch {
            errorCount++;
            currentDelay = Math.min(
                config.MAX_DELAY,
                config.BASE_DELAY * Math.pow(2, Math.min(errorCount, 5)) *
                (0.8 + Math.random() * 0.4)
            );
            return null;
        } finally {
            pendingRequests.delete(itemId);
        }
    }

    function insertOverlay(container, label) {
        if (!container || container.querySelector(`.${overlayClass}`)) return;
        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }
        container.appendChild(createLabel(label));
    }

    function getItemIdFromElement(el) {
        if (el.href) {
            const m = el.href.match(/id=([a-f0-9]{32})/i);
            if (m) return m[1];
        }
        if (el.style.backgroundImage) {
            const m = el.style.backgroundImage.match(/\/Items\/([a-f0-9]{32})\//i);
            if (m) return m[1];
        }
        return null;
    }

    function shouldIgnoreElement(el) {
        return IGNORE_SELECTORS.some(sel => el.closest(sel));
    }

    async function processElement(el, isPriority = false) {
        if (shouldIgnoreElement(el)) return;
        const itemId = getItemIdFromElement(el);
        if (!itemId || seenItems.has(itemId)) return;
        seenItems.add(itemId);

        const cached = qualityOverlayCache[itemId];
        if (cached) {
            insertOverlay(el, cached.quality);
            return;
        }

        const userId = getUserId();
        if (!userId) return;

        await new Promise(r => setTimeout(r, isPriority ? config.VISIBLE_PRIORITY_DELAY : currentDelay));
        const quality = await fetchItemQuality(userId, itemId);
        if (quality) insertOverlay(el, quality);
    }

    function isElementVisible(el) {
        const r = el.getBoundingClientRect();
        return (
            r.top <= window.innerHeight + 300 &&
            r.bottom >= -300 &&
            r.left <= window.innerWidth + 300 &&
            r.right >= -300
        );
    }

    function handleIntersection(entries) {
        entries.forEach(e => {
            if (e.isIntersecting) {
                visibilityObserver.unobserve(e.target);
                processElement(e.target, true);
            }
        });
    }

    function renderVisibleTags() {
        Array.from(document.querySelectorAll('a.cardImageContainer, div.listItemImage'))
            .forEach(el => {
                if (shouldIgnoreElement(el)) return;
                const id = getItemIdFromElement(el);
                if (!id) return;
                const cached = qualityOverlayCache[id];
                if (cached) insertOverlay(el, cached.quality);
                else if (isElementVisible(el)) processElement(el, true);
                else visibilityObserver.observe(el);
            });
    }

    function hookIntoHistoryChanges(cb) {
        const op = history.pushState, or = history.replaceState;
        history.pushState  = function(...a){ op.apply(this,a); cb(); };
        history.replaceState = function(...a){ or.apply(this,a); cb(); };
        window.addEventListener('popstate', cb);
    }

    function setupNavigationHandlers() {
        if (navigationHandlerSetup) return;
        navigationHandlerSetup = true;
        document.addEventListener('click', e => {
            if (e.target.closest('button.headerButtonLeft > span')) {
                setTimeout(() => {
                    seenItems.clear();
                    renderVisibleTags();
                }, 500);
            }
        });
        hookIntoHistoryChanges(() => {
            seenItems.clear();
            visibilityObserver.disconnect();
            setTimeout(renderVisibleTags, 300);
        });
    }

    function addStyles() {
        if (document.getElementById('quality-tag-style')) return;
        const s = document.createElement('style');
        s.id = 'quality-tag-style';
        s.textContent = `
            .${overlayClass} {
                user-select: none;
                pointer-events: none;
            }
        `;
        document.head.appendChild(s);
    }

    addStyles();
    setTimeout(() => {
        setupNavigationHandlers();
        renderVisibleTags();
    }, 1500);

    window.addEventListener('beforeunload', saveCache);
    setInterval(saveCache, 60000);

    const mutationObserver = new MutationObserver(ms => {
        if (ms.some(m => m.addedNodes.length)) setTimeout(renderVisibleTags,1000);
    });
    mutationObserver.observe(document.body,{ childList:true, subtree:true });

    async function fetchWithTimeout(url, timeout = config.REQUEST_TIMEOUT) {
        return Promise.race([
            fetch(url),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error('Timeout')),timeout))
        ]);
    }
})();

