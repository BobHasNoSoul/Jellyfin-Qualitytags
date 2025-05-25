(function () {
    const overlayClass = 'quality-overlay-label';
    const requestQueue = [];
    const qualityOverlayCache = {};
    const observedElements = new WeakSet();
    const seenItems = new Set();
    let activeRequests = 0;
    const maxRequestsPerSecond = 15;
    const maxQueueSize = 1000;

    function getUserId() {
        return (window.ApiClient && ApiClient._serverInfo && ApiClient._serverInfo.UserId) || null;
    }

    function createLabel(label) {
        const badge = document.createElement('div');
        badge.textContent = label;
        badge.className = overlayClass;
        return badge;
    }

    function getQuality(mediaStream) {
        if (!mediaStream) return 'SD';
        const height = mediaStream.Height || 0;
        if (height >= 1440) return 'UHD';
        if (height >= 531) return 'HD';
        return 'SD';
    }

    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .${overlayClass} {
                position: absolute;
                top: 6px;
                left: 6px;
                background: rgba(0, 102, 204, 0.85);
                color: white;
                padding: 2px 6px;
                font-size: 12px;
                font-weight: bold;
                border-radius: 4px;
                z-index: 99;
                pointer-events: none;
                user-select: none;
            }
        `;
        document.head.appendChild(style);
    }

    async function fetchFirstEpisode(userId, seriesId) {
        try {
            // Fetch the first episode of the series (all seasons recursively)
            const episodeResponse = await ApiClient.ajax({
                type: "GET",
                url: ApiClient.getUrl("/Items", {
                    ParentId: seriesId,
                    IncludeItemTypes: "Episode",
                    Recursive: true,
                    SortBy: "PremiereDate",
                    SortOrder: "Ascending",
                    Limit: 1,
                    userId: userId
                }),
                dataType: "json"
            });

            const episode = episodeResponse.Items?.[0];
            if (!episode?.Id) {
                console.warn("No episode found for series", seriesId);
                return null;
            }

            return episode;

        } catch (err) {
            console.error('Failed to fetch first episode for series', seriesId, err);
            return null;
        }
    }

    async function fetchAndInject(itemId, container) {
        if (qualityOverlayCache[itemId]) {
            insertOverlay(container, qualityOverlayCache[itemId]);
            return;
        }

        const userId = getUserId();
        if (!userId) return;

        try {
            const item = await ApiClient.getItem(userId, itemId);

            let videoStream = null;

            if (item.Type === "Series") {
                // Get the first episode metadata
                const ep = await fetchFirstEpisode(userId, itemId);
                if (ep?.Id) {
                    // Fetch full episode details to get media streams
                    const fullEp = await ApiClient.getItem(userId, ep.Id);
                    videoStream = fullEp?.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');
                }
            } else {
                videoStream = item?.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');
            }

            if (videoStream?.Height) {
                const quality = getQuality(videoStream);
                qualityOverlayCache[itemId] = quality;
                insertOverlay(container, quality);
            }
        } catch {
            // fail silently
        }
    }

    function insertOverlay(container, quality) {
        if (!container || container.querySelector(`.${overlayClass}`)) return;

        const wrapper = document.createElement('div');
        wrapper.style.position = 'absolute';
        wrapper.style.top = '0';
        wrapper.style.left = '0';
        wrapper.style.right = '0';
        wrapper.style.bottom = '0';
        wrapper.style.pointerEvents = 'none';
        wrapper.style.zIndex = '99';

        const label = createLabel(quality);
        wrapper.appendChild(label);

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        container.appendChild(wrapper);
    }

    function enqueueRequest(itemId, container) {
        if (requestQueue.length >= maxQueueSize) return;
        requestQueue.push({ itemId, container });
    }

    function processQueue() {
        if (activeRequests >= maxRequestsPerSecond || requestQueue.length === 0) return;

        const { itemId, container } = requestQueue.shift();
        activeRequests++;

        fetchAndInject(itemId, container).finally(() => {
            activeRequests--;
        });
    }

    setInterval(processQueue, 1000 / maxRequestsPerSecond);

    let intersectionObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const el = entry.target;
            if (!entry.isIntersecting || !el.href) continue;

            if (observedElements.has(el)) continue;
            const match = el.href.match(/id=([a-f0-9]{32})/i);
            if (!match) continue;

            const itemId = match[1];
            if (seenItems.has(itemId)) continue;

            seenItems.add(itemId);
            observedElements.add(el);
            intersectionObserver.unobserve(el);

            if (qualityOverlayCache[itemId]) {
                insertOverlay(el, qualityOverlayCache[itemId]);
            } else {
                enqueueRequest(itemId, el);
            }
        }
    }, { rootMargin: '200px' });

    function scanCards() {
        document.querySelectorAll('a.cardImageContainer').forEach(el => {
            if (!observedElements.has(el)) {
                intersectionObserver.observe(el);
            }
        });
    }

    let mutationTimeout;
    const mutationObserver = new MutationObserver(() => {
        clearTimeout(mutationTimeout);
        mutationTimeout = setTimeout(scanCards, 300);
    });

    addStyles();
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    scanCards();
})();
