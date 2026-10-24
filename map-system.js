(() => {
  const $ = id => document.getElementById(id);
  const overlay = $('map-overlay');
  const stage = $('map-stage');
  const globeHost = $('map-globe');
  const canvas = $('map-demo-canvas');
  const context = canvas.getContext('2d');
  const status = $('map-status');
  const results = $('map-results');
  const coordinateReadout = $('map-coordinate');
  const demoBadge = $('map-demo-badge');
  const searchInput = $('map-search-input');
  const places = [
    { name: 'Kochi, Kerala, India (demo)', aliases: ['kochi', 'kochi kerala'], lat: 9.9312, lon: 76.2673 },
    { name: 'Thiruvananthapuram, Kerala, India (demo)', aliases: ['thiruvananthapuram', 'trivandrum'], lat: 8.5241, lon: 76.9366 },
    { name: 'London, United Kingdom (demo)', aliases: ['london'], lat: 51.5072, lon: -0.1276 },
    { name: 'Tokyo, Japan (demo)', aliases: ['tokyo'], lat: 35.6762, lon: 139.6503 },
    { name: 'New York, USA (demo)', aliases: ['new york'], lat: 40.7128, lon: -74.0060 }
  ];
  let viewer = null;
  let geocoder = null;
  let initialized = false;
  let demoMode = true;
  let selected = null;
  let rotation = 0;
  let demoZoom = 1;
  let gridVisible = true;
  let labelsVisible = true;
  let resizeObserver = null;

  function setStatus(message) { status.textContent = message; }
  function formatCoordinates(lat, lon) {
    const ns = lat < 0 ? 'S' : 'N', ew = lon < 0 ? 'W' : 'E';
    return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}`;
  }
  function setLocation(location) {
    selected = location;
    coordinateReadout.textContent = `${location.name}  ·  ${formatCoordinates(location.lat, location.lon)}`;
    if (demoMode) {
      rotation = -location.lon * Math.PI / 180;
      drawDemoGlobe();
      $('map-altitude').textContent = `ALT ${Math.round(19000 / demoZoom).toLocaleString()} KM / DEMO`;
      setStatus(`${location.name} · demo coordinates; configure Cesium ion for live place search and satellite imagery.`);
      return;
    }
    viewer.entities.removeById('flow-place-pin');
    viewer.entities.add({
      id: 'flow-place-pin',
      name: location.name,
      position: Cesium.Cartesian3.fromDegrees(location.lon, location.lat, 100),
      point: { pixelSize: 13, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
      label: { text: location.name, font: '13px Share Tech Mono', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -22), disableDepthTestDistance: Number.POSITIVE_INFINITY }
    });
    viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(location.lon, location.lat, 38000), duration: 1.8 });
    $('map-altitude').textContent = 'ALT 38 KM';
    setStatus(`${location.name} · coordinates from the search result. Accuracy depends on the provider’s location data.`);
  }

  function drawDemoGlobe() {
    if (!demoMode || canvas.hidden) return;
    const box = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(box.width * dpr)), height = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = box.width, h = box.height, cx = w * 0.5, cy = h * 0.52, radius = Math.min(w * 0.36, h * 0.43) * demoZoom;
    context.clearRect(0, 0, w, h);
    const stars = [[.12,.18],[.81,.19],[.88,.72],[.19,.82],[.69,.1],[.34,.12],[.76,.88],[.1,.63],[.58,.86],[.92,.42]];
    context.fillStyle = '#020a14'; context.fillRect(0, 0, w, h);
    stars.forEach(([x,y],i)=>{context.globalAlpha=.25+(i%3)*.17;context.fillStyle='#baf7ff';context.beginPath();context.arc(x*w,y*h,i%4===0?1.5:1,0,Math.PI*2);context.fill()}); context.globalAlpha=1;
    context.save(); context.translate(cx, cy);
    context.shadowColor = 'rgba(22,208,255,.52)'; context.shadowBlur = 24;
    const ocean = context.createRadialGradient(-radius*.34,-radius*.38,radius*.08,0,0,radius*1.05);
    ocean.addColorStop(0,'#155c85'); ocean.addColorStop(.55,'#07355b'); ocean.addColorStop(1,'#020c21');
    context.fillStyle = ocean; context.beginPath(); context.arc(0,0,radius,0,Math.PI*2); context.fill(); context.shadowBlur=0;
    context.save(); context.beginPath(); context.arc(0,0,radius,0,Math.PI*2); context.clip();
    if(gridVisible){
      context.strokeStyle='rgba(115,228,255,.2)'; context.lineWidth=1;
      for(let lat=-60;lat<=60;lat+=30){const yy=-Math.sin(lat*Math.PI/180)*radius;const ww=Math.cos(lat*Math.PI/180)*radius;context.beginPath();context.ellipse(0,yy,ww,radius*.09,0,0,Math.PI*2);context.stroke()}
      for(let lon=-60;lon<=60;lon+=30){const xx=Math.sin(lon*Math.PI/180)*radius;context.beginPath();context.ellipse(xx,0,radius*.08,radius,0,0,Math.PI*2);context.stroke()}
    }
    const continents = [
      [[-168,70],[-145,69],[-128,55],[-117,48],[-105,49],[-92,28],[-82,24],[-96,15],[-108,24],[-117,33],[-128,47],[-151,58]],
      [[-80,12],[-65,9],[-51,-1],[-48,-18],[-60,-39],[-69,-54],[-76,-33],[-81,-4]],
      [[-53,80],[-39,73],[-43,61],[-56,59],[-67,72]],
      [[-11,36],[2,52],[23,60],[38,54],[44,42],[32,35],[18,37],[8,43]],
      [[-17,35],[4,37],[28,31],[39,10],[32,-10],[20,-35],[6,-34],[-1,-18],[-13,4]],
      [[35,55],[50,68],[83,72],[112,65],[137,55],[154,48],[145,35],[124,28],[115,15],[101,7],[92,20],[77,8],[68,25],[53,27],[42,40]],
      [[112,-11],[131,-12],[153,-24],[151,-38],[132,-43],[115,-31]],
      [[-180,-70],[-120,-72],[-60,-70],[0,-72],[60,-70],[120,-72],[180,-70],[180,-82],[-180,-82]]
    ];
    continents.forEach(poly=>{
      const projected=poly.map(([lon,lat])=>{
        const l=lon*Math.PI/180+rotation, a=lat*Math.PI/180;
        return {x:Math.cos(a)*Math.sin(l)*radius,y:-Math.sin(a)*radius,z:Math.cos(a)*Math.cos(l)};
      });
      if(projected.every(point=>point.z>-.12)){
        context.beginPath(); projected.forEach((point,i)=>i?context.lineTo(point.x,point.y):context.moveTo(point.x,point.y)); context.closePath();
        context.fillStyle='rgba(117,151,105,.94)';context.fill();context.strokeStyle='rgba(199,197,135,.4)';context.stroke();
      }
    });
    context.save();context.globalAlpha=.12;context.strokeStyle='#d8faff';context.lineWidth=2;
    for(let band=0;band<6;band++){const y=-radius*.55+band*radius*.19;context.beginPath();context.moveTo(-radius*.72,y);context.bezierCurveTo(-radius*.25,y-radius*.12,radius*.18,y+radius*.13,radius*.72,y-radius*.04);context.stroke()}
    context.restore();
    if(selected){
      const lon=selected.lon*Math.PI/180+rotation, lat=selected.lat*Math.PI/180;
      const x=Math.cos(lat)*Math.sin(lon)*radius, y=-Math.sin(lat)*radius, z=Math.cos(lat)*Math.cos(lon);
      if(z>0){context.beginPath();context.arc(x,y,5,0,Math.PI*2);context.fillStyle='#bdfaff';context.shadowColor='#20eaff';context.shadowBlur=18;context.fill();context.shadowBlur=0;context.beginPath();context.arc(x,y,11,0,Math.PI*2);context.strokeStyle='rgba(43,236,255,.8)';context.stroke()}
    }
    context.restore();
    const shade=context.createRadialGradient(-radius*.32,-radius*.32,radius*.3,0,0,radius*1.1);shade.addColorStop(0,'rgba(255,255,255,.08)');shade.addColorStop(.78,'rgba(0,0,0,.05)');shade.addColorStop(1,'rgba(0,2,10,.68)');context.fillStyle=shade;context.beginPath();context.arc(0,0,radius,0,Math.PI*2);context.fill();
    context.strokeStyle='rgba(107,237,255,.75)';context.lineWidth=1.2;context.beginPath();context.arc(0,0,radius,0,Math.PI*2);context.stroke();
    context.strokeStyle='rgba(127,238,255,.2)';context.lineWidth=1;context.beginPath();context.ellipse(0,0,radius*1.34,radius*.38,-.28,0,Math.PI*2);context.stroke();context.restore();
  }

  function enableDemo(reason) {
    demoMode = true; viewer = null; geocoder = null; globeHost.style.display = 'none';
    canvas.hidden = false; demoBadge.hidden = false; $('map-attribution').textContent = 'FLOW illustrative globe preview';
    selected = { name: 'Kochi, Kerala (demo)', lat: 9.9312, lon: 76.2673 };
    demoZoom = 1; gridVisible = true; $('map-grid-label').textContent = 'GRID: ON'; $('map-mode-label').textContent = '3D GLOBE / DEMO MODE'; $('map-layer').textContent = 'LAY';
    rotation = -selected.lon * Math.PI / 180; coordinateReadout.textContent = `${selected.name}  ·  ${formatCoordinates(selected.lat, selected.lon)}`;
    $('map-altitude').textContent = 'ALT 19,000 KM / DEMO';
    setStatus(reason || 'Demo preview: Kochi is shown with sample coordinates. Add a Cesium ion token for actual satellite tiles and place search.');
    drawDemoGlobe();
    if (!resizeObserver && window.ResizeObserver) { resizeObserver = new ResizeObserver(drawDemoGlobe); resizeObserver.observe(stage); }
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    try {
      const configResponse = await fetch('/api/map-config', { cache: 'no-store' });
      const config = await configResponse.json();
      if (!window.Cesium) throw new Error('CesiumJS did not load. The demo globe is shown instead.');
      if (!config.token) { enableDemo(); return; }
      demoMode = false; canvas.hidden = true; demoBadge.hidden = true; globeHost.style.display = 'block';
      $('map-attribution').textContent = 'Cesium ion satellite imagery and geocoder';
      Cesium.Ion.defaultAccessToken = config.token;
      viewer = new Cesium.Viewer(globeHost, {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        baseLayer: Cesium.ImageryLayer.fromWorldImagery({ style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS }),
        animation: false, timeline: false, geocoder: false, baseLayerPicker: false,
        homeButton: false, sceneModePicker: false, navigationHelpButton: false,
        fullscreenButton: false, infoBox: false, selectionIndicator: false,
        sceneMode: Cesium.SceneMode.SCENE3D, requestRenderMode: true
      });
      viewer.scene.globe.enableLighting = true;
      geocoder = new Cesium.IonGeocoderService({ scene: viewer.scene, accessToken: config.token });
      viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(0, 20, 25000000) });
      $('map-mode-label').textContent = '3D SATELLITE / CESIUM ION'; $('map-grid-label').textContent = 'LABELS: ON'; $('map-layer').textContent = 'LAB';
      viewer.camera.moveEnd.addEventListener(() => {
        const km = Math.max(1, Math.round(viewer.camera.positionCartographic.height / 1000));
        $('map-altitude').textContent = `ALT ${km.toLocaleString()} KM`;
      });
      setStatus('Satellite globe ready. Search a place or enter latitude, longitude.');
      viewer.screenSpaceEventHandler.setInputAction(event => {
        const point = viewer.camera.pickEllipsoid(event.position, viewer.scene.globe.ellipsoid);
        if (!point) return;
        const location = Cesium.Cartographic.fromCartesian(point);
        setLocation({ name: 'Selected point', lat: Cesium.Math.toDegrees(location.latitude), lon: Cesium.Math.toDegrees(location.longitude) });
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    } catch (error) {
      enableDemo(`Satellite map unavailable: ${error.message}. Showing the offline demo globe.`);
    }
  }

  function coordinateQuery(query) {
    const match = query.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (!match) return null;
    const lat = Number(match[1]), lon = Number(match[2]);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { name: 'Entered coordinates', lat, lon } : null;
  }

  function resultCoordinates(result) {
    const destination = result.destination;
    let cartographic;
    if (destination instanceof Cesium.Rectangle) cartographic = Cesium.Rectangle.center(destination);
    else cartographic = Cesium.Cartographic.fromCartesian(destination);
    if (!cartographic) return null;
    return { name: result.displayName || 'Search result', lat: Cesium.Math.toDegrees(cartographic.latitude), lon: Cesium.Math.toDegrees(cartographic.longitude) };
  }

  function showResults(matches) {
    results.replaceChildren();
    matches.forEach(location => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'map-result orb';
      const title = document.createElement('span'); title.textContent = location.name;
      const coords = document.createElement('small'); coords.textContent = formatCoordinates(location.lat, location.lon);
      button.append(title, coords); button.addEventListener('click', () => { setLocation(location); results.replaceChildren(); }); results.appendChild(button);
    });
  }

  async function search(query) {
    const value = String(query || '').trim();
    if (!value) { setStatus('Enter a place name or coordinates.'); return; }
    results.replaceChildren();
    const direct = coordinateQuery(value);
    if (direct) { setLocation(direct); return; }
    if (demoMode || !geocoder) {
      const normalized = value.toLocaleLowerCase();
      const found = places.find(place => place.aliases.includes(normalized));
      if (found) { setLocation(found); return; }
      setStatus('Demo mode supports sample places (try Kochi) and latitude, longitude. Add a Cesium ion token for global place search.');
      return;
    }
    setStatus('Searching places…');
    try {
      const matches = await geocoder.geocode(value, Cesium.GeocodeType.SEARCH);
      const locations = (matches || []).map(resultCoordinates).filter(Boolean).slice(0, 5);
      if (!locations.length) { setStatus('No matching place found. Try adding a city or country.'); return; }
      if (locations.length === 1) setLocation(locations[0]);
      else { showResults(locations); setStatus(`${locations.length} matches found. Choose the correct place.`); }
    } catch (error) { setStatus(`Place search failed: ${error.message}`); }
  }

  function open() {
    overlay.hidden = false; overlay.setAttribute('aria-hidden', 'false');
    initialize().then(() => { if (viewer) { viewer.resize(); viewer.scene.requestRender(); } else drawDemoGlobe(); });
    setTimeout(() => searchInput.focus(), 60);
  }
  function close() { overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); $('tb-map').focus(); }

  function zoom(factor) {
    if (viewer) {
      if (factor > 1) viewer.camera.zoomOut(28000); else viewer.camera.zoomIn(28000);
      return;
    }
    demoZoom = Math.max(.74, Math.min(1.22, demoZoom * factor));
    $('map-altitude').textContent = `ALT ${Math.round(19000 / demoZoom).toLocaleString()} KM / DEMO`;
    drawDemoGlobe();
  }

  function resetGlobe() {
    if (viewer) {
      viewer.entities.removeById('flow-place-pin'); selected = null;
      coordinateReadout.textContent = 'No location selected';
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(0, 20, 25000000), duration: 1.5 });
      return;
    }
    setLocation({ name: 'Kochi, Kerala (demo)', lat: 9.9312, lon: 76.2673 });
    demoZoom = 1; drawDemoGlobe();
  }

  async function toggleLayer() {
    if (!viewer) {
      gridVisible = !gridVisible;
      $('map-grid-label').textContent = `GRID: ${gridVisible ? 'ON' : 'OFF'}`;
      $('map-layer').textContent = gridVisible ? 'LAY' : 'GRD';
      drawDemoGlobe(); return;
    }
    labelsVisible = !labelsVisible;
    try {
      const layer = Cesium.ImageryLayer.fromWorldImagery({ style: labelsVisible ? Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS : Cesium.IonWorldImageryStyle.AERIAL });
      viewer.imageryLayers.removeAll(false); viewer.imageryLayers.add(layer);
      $('map-grid-label').textContent = `LABELS: ${labelsVisible ? 'ON' : 'OFF'}`;
      $('map-layer').textContent = labelsVisible ? 'LAB' : 'SAT';
      viewer.scene.requestRender();
    } catch (error) { setStatus(`Could not change imagery layer: ${error.message}`); }
  }

  $('tb-map').addEventListener('click', open);
  $('map-close').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.hidden) close(); });
  $('map-search-form').addEventListener('submit', event => { event.preventDefault(); search(searchInput.value); });
  $('map-zoom-in').addEventListener('click', () => zoom(.82));
  $('map-zoom-out').addEventListener('click', () => zoom(1.22));
  $('map-home').addEventListener('click', resetGlobe);
  $('map-layer').addEventListener('click', toggleLayer);
  $('map-copy').addEventListener('click', async () => {
    if (!selected) { setStatus('Choose a place first.'); return; }
    const text = `${selected.lat.toFixed(6)}, ${selected.lon.toFixed(6)}`;
    try { await navigator.clipboard.writeText(text); setStatus(`Copied ${text}`); }
    catch { setStatus(`Coordinates: ${text}`); }
  });
  canvas.addEventListener('click', event => {
    if (!demoMode) return;
    const rect = canvas.getBoundingClientRect(), radius = Math.min(rect.width * .36, rect.height * .43);
    const x = event.clientX - rect.left - rect.width * .5, y = event.clientY - rect.top - rect.height * .52;
    const distance = Math.hypot(x,y); if (distance > radius) return;
    const z = Math.sqrt(Math.max(0, 1 - (distance/radius) ** 2));
    const lat = Math.asin(-y/radius) * 180/Math.PI;
    const lon = Math.asin(Math.max(-1,Math.min(1,x/(radius*Math.max(.001,Math.cos(lat*Math.PI/180)))))) * 180/Math.PI - rotation*180/Math.PI;
    setLocation({ name: 'Demo globe point', lat: Math.max(-90,Math.min(90,lat)), lon: ((lon+540)%360)-180 });
  });
  window.addEventListener('resize', drawDemoGlobe);
})();
