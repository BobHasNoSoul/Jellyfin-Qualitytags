(function () {
    // --- CONFIGURATION & CONSTANTS ---
    const overlayClass = 'quality-overlay-label';
    const CACHE_VERSION = 'v15';
    const CACHE_KEY = `qualityOverlayCache-${CACHE_VERSION}`;

    const IGNORE_SELECTORS = [
        'html.preload.layout-desktop body.force-scroll.libraryDocument div#reactRoot div.mainAnimatedPages.skinBody div#itemDetailPage.page.libraryPage.itemDetailPage.noSecondaryNavPage.selfBackdropPage.mainAnimatedPage div.detailPageWrapperContainer div.detailPageSecondaryContainer.padded-bottom-page div.detailPageContent div#castCollapsible.verticalSection.detailVerticalSection.emby-scroller-container a.cardImageContainer',
        'html.preload.layout-desktop body.force-scroll.libraryDocument.withSectionTabs.mouseIdle div#reactRoot div.mainAnimatedPages.skinBody div#indexPage.page.homePage.libraryPage.allLibraryPage.backdropPage.pageWithAbsoluteTabs.withTabs.mainAnimatedPage div#homeTab.tabContent.pageTabContent.is-active div.sections.homeSectionsContainer div.verticalSection.MyMedia.emby-scroller-container a.cardImageContainer'
    ];

    const MEDIA_TYPES = new Set(['Movie','Episode','Series','Season','Audio','MusicAlbum','AudioBook','Book']);

    const colors = {
        '720p': 'rgba(255,165,0,0.85)', '1080p': 'rgba(0,204,204,0.85)', 'UHD': 'rgba(0,153,51,0.85)', 'SD': 'rgba(150,150,150,0.85)',
        'MP3': 'rgba(255,192,203,0.85)', 'FLAC': 'rgba(255,218,185,0.85)', 'M4A': 'rgba(255,255,204,0.85)', 'OPUS': 'rgba(173,216,230,0.85)', 'AAC': 'rgba(152,251,152,0.85)', 'OGG': 'rgba(221,160,221,0.85)',
        'EPUB': 'rgba(176,196,222,0.85)', 'PDF': 'rgba(205,133,63,0.85)', 'MOBI': 'rgba(222,184,135,0.85)', 'AZW3': 'rgba(240,230,140,0.85)', 'CBZ': 'rgba(255,228,196,0.85)', 'CBR': 'rgba(255,222,173,0.85)', 'DJVU': 'rgba(221,160,221,0.85)', 'PDB': 'rgba(176,224,230,0.85)', 'FB2': 'rgba(152,251,152,0.85)'
    };

    const config = { BASE_DELAY:1000, MAX_DELAY:10000, VISIBLE_PRIORITY_DELAY:200, CACHE_TTL:7*24*60*60*1000, REQUEST_TIMEOUT:5000 };

    let cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    let seen = new Set(), pending = new Set(), errorCount = 0, delay = config.BASE_DELAY;

    const observer = new IntersectionObserver(onIntersect, { rootMargin: '300px', threshold: 0.01 });
    const mutObs = new MutationObserver(render);

    function getUserId() { try { return window.ApiClient?._serverInfo?.UserId || null; } catch { return null; } }
    function save() { try { const now = Date.now(); Object.entries(cache).forEach(([k,v])=>{ if(now-v.ts>config.CACHE_TTL) delete cache[k]; }); localStorage.setItem(CACHE_KEY,JSON.stringify(cache)); } catch {} }

    function createBadge(text) { const d=document.createElement('div'); d.textContent=text; d.className=overlayClass; d.style.cssText=`background:${colors[text]||colors.SD};position:absolute;top:6px;left:6px;color:white;padding:2px 6px;font-size:12px;font-weight:bold;border-radius:4px;z-index:99;pointer-events:none;user-select:none;`; return d; }

    function detectTag(item) {
        if (!item) return null;
        // reuse original fetchItemQuality logic for book
        if (item.Type==='Book') {
            // check extension and Format
            const ext=(item.Path||'').split('.').pop().toUpperCase();
            if (ext && colors[ext]) return ext;
            if (item.Format && colors[item.Format.toUpperCase()]) return item.Format.toUpperCase();
        }
        // fallback to mediaStreams/container
        const src=item.MediaSources?.[0]; if(!src) return null;
        if (['Movie','Episode','Series','Season'].includes(item.Type)) {
            const vs=src.MediaStreams?.find(s=>s.Type==='Video'); const h=vs?.Height||0;
            if(h>=2160) return 'UHD'; if(h>=1080) return '1080p'; if(h>=720) return '720p'; if(h>0) return 'SD';
        }
        if (['Audio','MusicAlbum','AudioBook'].includes(item.Type)) {
            const aud=src.MediaStreams?.find(s=>s.Type==='Audio'); const codec=aud?.Codec?.toUpperCase(); if(codec && colors[codec]) return codec;
            const cont=src.Container?.toUpperCase(); if(cont && colors[cont]) return cont;
        }
        return null;
    }

    async function fetchTag(uid,id) {
        if (pending.has(id)) return null; pending.add(id);
        try {
            let it=await ApiClient.getItem(uid,id); if(!it||!MEDIA_TYPES.has(it.Type)) return null;
            if (it.Type==='Series' || it.Type==='Season') {
                const eps=await ApiClient.ajax({type:'GET',url:ApiClient.getUrl('/Items',{ParentId:it.Id,IncludeItemTypes:'Episode',Recursive:true,SortBy:'PremiereDate',SortOrder:'Ascending',Limit:1,userId:uid}),dataType:'json'});
                const ep=eps.Items?.[0]; if(ep?.Id) it=await ApiClient.getItem(uid,ep.Id);
            }
            if (it.Type==='MusicAlbum') {
                const auds=await ApiClient.ajax({type:'GET',url:ApiClient.getUrl('/Items',{ParentId:it.Id,IncludeItemTypes:'Audio',Limit:1,SortBy:'TrackNumber',SortOrder:'Ascending',userId:uid}),dataType:'json'});
                const tr=auds.Items?.[0]; if(tr?.Id) it=await ApiClient.getItem(uid,tr.Id);
            }
            const tag=detectTag(it);
            if(tag){ cache[id]={tag,ts:Date.now()}; save(); return tag; }
        } catch { errorCount++; delay=Math.min(config.MAX_DELAY,config.BASE_DELAY*Math.pow(2,errorCount)*(0.8+Math.random())); }
        finally{ pending.delete(id);} return null;
    }

    function getId(el) { const m=el.href?.match(/id=([a-f0-9]{32})/i)||el.style.backgroundImage?.match(/\/Items\/([a-f0-9]{32})\//i); return m?m[1]:el.dataset.id||null; }
    function insert(el,txt){ if(!el||el.querySelector(`.${overlayClass}`)) return; if(getComputedStyle(el).position==='static') el.style.position='relative'; el.appendChild(createBadge(txt)); }

    async function process(el,prio=false){ const id=getId(el); if(!id||seen.has(id)) return; seen.add(id);
        if(cache[id]){ insert(el,cache[id].tag); return; }
        const uid=getUserId(); if(!uid) return;
        await new Promise(r=>setTimeout(r,prio?config.VISIBLE_PRIORITY_DELAY:delay));
        if(cache[id]){ insert(el,cache[id].tag); return; }
        const t=await fetchTag(uid,id); if(t) insert(el,t);
    }

    function onIntersect(entries){ entries.forEach(e=>{ if(e.isIntersecting){ observer.unobserve(e.target); process(e.target,true);} }); }
    function isVisible(el){ const r=el.getBoundingClientRect(); return r.top<=innerHeight+300&&r.bottom>=-300&&r.left<=innerWidth+300&&r.right>=-300; }
    function render(){ document.querySelectorAll('a.cardImageContainer,div.listItemImage,.card').forEach(el=>{ const c=el.querySelector('a.cardImageContainer,div.listItemImage')||el; const id=getId(c); if(!id) return; if(cache[id]) insert(c,cache[id].tag); else if(isVisible(c)) process(c,true); else observer.observe(c);} ); }

    function setupNav(){ const p=history.pushState,r=history.replaceState; history.pushState=function(...a){p.apply(this,a);render();}; history.replaceState=function(...a){r.apply(this,a);render();}; addEventListener('popstate',render); document.addEventListener('click',e=>{ if(e.target.closest('button.headerButtonLeft>span')) setTimeout(render,500); }); }
    function addStyles(){ if(document.getElementById('quality-tag-style')) return; const s=document.createElement('style'); s.id='quality-tag-style'; s.textContent=`.${overlayClass}{user-select:none;pointer-events:none;}`; document.head.appendChild(s);}    

    // initialize
    addStyles(); mutObs.observe(document.body,{childList:true,subtree:true}); setupNav(); setTimeout(render,1500); window.addEventListener('beforeunload',save); setInterval(save,60000);
})();
