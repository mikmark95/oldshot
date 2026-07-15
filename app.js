(() => {
  'use strict';

  const MAX_DIMENSION = 2000; // cap for full-resolution processing / download
  const THUMB_MAX = 560; // cap for the fast live-preview thumbnails
  const MAX_PHOTOS = 20;

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const controlsSection = document.getElementById('controls-section');
  const gallerySection = document.getElementById('gallery-section');
  const photosGrid = document.getElementById('photos-grid');
  const photosSummary = document.getElementById('photos-summary');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const downloadAllBtn = document.getElementById('download-all-btn');
  const statusMsg = document.getElementById('status-msg');
  const intensityInput = document.getElementById('intensity');
  const grainInput = document.getElementById('grain');
  const vignetteInput = document.getElementById('vignette');
  const styleSepiaBtn = document.getElementById('style-sepia-btn');
  const styleBwBtn = document.getElementById('style-bw-btn');

  // Offscreen canvases used purely as scratch space, never attached to the DOM.
  const thumbScratchCanvas = document.createElement('canvas');
  const thumbScratchCtx = thumbScratchCanvas.getContext('2d');
  const fullScratchCanvas = document.createElement('canvas');
  const fullScratchCtx = fullScratchCanvas.getContext('2d');
  const fullOutputCanvas = document.createElement('canvas');
  const fullOutputCtx = fullOutputCanvas.getContext('2d');

  let photos = [];
  let nextPhotoId = 0;
  let renderTimer = null;
  let batchInProgress = false;
  let colorMode = 'sepia'; // 'sepia' | 'bw'

  function setStatus(msg) {
    statusMsg.textContent = msg || '';
  }

  function isMobileDevice() {
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
    // iPadOS 13+ Safari reports its UA as a plain "Macintosh" desktop, with no
    // "iPad" token at all. A real Mac has no touch points, so use that to tell
    // the two apart and still route iPads through the native share sheet.
    if (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function fitDimensions(width, height, max) {
    if (width <= max && height <= max) return { width, height };
    const scale = max / Math.max(width, height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  }

  function getEffectSettings() {
    return {
      intensity: Number(intensityInput.value) / 100,
      grain: Number(grainInput.value) / 100,
      vignette: Number(vignetteInput.value) / 100,
      blackAndWhite: colorMode === 'bw',
    };
  }

  function setColorMode(mode) {
    if (mode === colorMode) return;
    colorMode = mode;
    styleSepiaBtn.classList.toggle('active', mode === 'sepia');
    styleBwBtn.classList.toggle('active', mode === 'bw');
    renderAllCards();
  }

  function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  // Applies the vintage effect (sepia or black & white, reduced contrast,
  // grain, vignette) from a source ImageData onto a target canvas context.
  function applyVintage(srcImageData, width, height, targetCtx, settings) {
    const { intensity, grain, vignette, blackAndWhite } = settings;
    const src = srcImageData.data;
    const out = new Uint8ClampedArray(src.length);

    const contrastFactor = 1 - 0.35 * intensity;
    const midpoint = 128;

    for (let i = 0; i < src.length; i += 4) {
      let r = src[i];
      let g = src[i + 1];
      let b = src[i + 2];
      const a = src[i + 3];

      r = (r - midpoint) * contrastFactor + midpoint;
      g = (g - midpoint) * contrastFactor + midpoint;
      b = (b - midpoint) * contrastFactor + midpoint;

      if (blackAndWhite) {
        const gray = r * 0.299 + g * 0.587 + b * 0.114;
        r = r + (gray - r) * intensity;
        g = g + (gray - g) * intensity;
        b = b + (gray - b) * intensity;
      } else {
        const sr = r * 0.393 + g * 0.769 + b * 0.189;
        const sg = r * 0.349 + g * 0.686 + b * 0.168;
        const sb = r * 0.272 + g * 0.534 + b * 0.131;

        r = r + (sr - r) * intensity;
        g = g + (sg - g) * intensity;
        b = b + (sb - b) * intensity;
      }

      out[i] = clamp(r);
      out[i + 1] = clamp(g);
      out[i + 2] = clamp(b);
      out[i + 3] = a;
    }

    if (grain > 0) {
      const grainStrength = grain * 45;
      for (let i = 0; i < out.length; i += 4) {
        const noise = (Math.random() - 0.5) * grainStrength;
        out[i] = clamp(out[i] + noise);
        out[i + 1] = clamp(out[i + 1] + noise);
        out[i + 2] = clamp(out[i + 2] + noise);
      }
    }

    targetCtx.canvas.width = width;
    targetCtx.canvas.height = height;
    targetCtx.putImageData(new ImageData(out, width, height), 0, 0);

    if (vignette > 0) {
      const cx = width / 2;
      const cy = height / 2;
      const outerRadius = Math.sqrt(cx * cx + cy * cy);
      const gradient = targetCtx.createRadialGradient(
        cx, cy, outerRadius * (1 - vignette * 0.7) * 0.3,
        cx, cy, outerRadius
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(0,0,0,${0.75 * vignette})`);
      targetCtx.fillStyle = gradient;
      targetCtx.fillRect(0, 0, width, height);
    }
  }

  // --- Photo lifecycle ---

  function loadPhotoFile(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const { width: tw, height: th } = fitDimensions(img.naturalWidth, img.naturalHeight, THUMB_MAX);
          thumbScratchCanvas.width = tw;
          thumbScratchCanvas.height = th;
          thumbScratchCtx.clearRect(0, 0, tw, th);
          thumbScratchCtx.drawImage(img, 0, 0, tw, th);
          const thumbImageData = thumbScratchCtx.getImageData(0, 0, tw, th);
          resolve({
            id: `p${nextPhotoId++}`,
            file,
            name: file.name || 'foto',
            thumbWidth: tw,
            thumbHeight: th,
            thumbImageData,
            showingOriginal: false,
          });
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  async function handleFiles(fileList) {
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (!incoming.length) {
      setStatus('Seleziona almeno un file immagine valido.');
      return;
    }

    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setStatus(`Hai già raggiunto il limite di ${MAX_PHOTOS} foto.`);
      return;
    }

    const toLoad = incoming.slice(0, room);
    setStatus('Caricamento foto…');

    const loaded = await Promise.all(toLoad.map(loadPhotoFile));
    const validPhotos = loaded.filter(Boolean);

    validPhotos.forEach((photo) => {
      photos.push(photo);
      createPhotoCard(photo);
    });

    if (incoming.length > toLoad.length) {
      setStatus(`Caricate ${validPhotos.length} foto (limite massimo ${MAX_PHOTOS} raggiunto).`);
    } else if (validPhotos.length < toLoad.length) {
      setStatus('Alcune immagini non sono state caricate correttamente.');
    } else {
      setStatus('');
    }

    if (validPhotos.length) {
      showResultUI();
      updateSummary();
      scheduleRender();
    }
  }

  function createPhotoCard(photo) {
    const card = document.createElement('div');
    card.className = 'photo-card';
    card.dataset.id = photo.id;
    card.title = photo.name;

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'photo-card-canvas-wrap';

    const canvas = document.createElement('canvas');
    canvas.className = 'mini-canvas';
    canvas.width = photo.thumbWidth;
    canvas.height = photo.thumbHeight;
    photo.canvasCtx = canvas.getContext('2d');
    photo.canvasCtx.putImageData(photo.thumbImageData, 0, 0);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'photo-remove';
    removeBtn.setAttribute('aria-label', 'Rimuovi questa foto');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => removePhoto(photo.id));

    const tag = document.createElement('span');
    tag.className = 'mini-tag';
    tag.textContent = 'Vintage';
    photo.tagEl = tag;

    canvasWrap.append(canvas, removeBtn, tag);

    const footer = document.createElement('div');
    footer.className = 'photo-card-footer';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'toggle-original-btn';
    toggleBtn.textContent = 'Originale';
    toggleBtn.addEventListener('click', () => toggleOriginal(photo));
    photo.toggleBtn = toggleBtn;

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'icon-btn photo-download-btn';
    downloadBtn.setAttribute('aria-label', 'Scarica questa foto');
    downloadBtn.title = 'Scarica questa foto';
    downloadBtn.textContent = '⬇';
    downloadBtn.addEventListener('click', () => downloadSinglePhoto(photo, downloadBtn));

    footer.append(toggleBtn, downloadBtn);

    card.append(canvasWrap, footer);
    photosGrid.appendChild(card);
    photo.cardEl = card;
  }

  function toggleOriginal(photo) {
    photo.showingOriginal = !photo.showingOriginal;
    if (photo.showingOriginal) {
      photo.canvasCtx.canvas.width = photo.thumbWidth;
      photo.canvasCtx.canvas.height = photo.thumbHeight;
      photo.canvasCtx.putImageData(photo.thumbImageData, 0, 0);
      photo.tagEl.textContent = 'Originale';
      photo.toggleBtn.textContent = 'Vintage';
    } else {
      renderCardVintage(photo);
      photo.tagEl.textContent = 'Vintage';
      photo.toggleBtn.textContent = 'Originale';
    }
  }

  function removePhoto(id) {
    const idx = photos.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const [photo] = photos.splice(idx, 1);
    photo.cardEl.remove();
    updateSummary();
    if (!photos.length) resetUI();
  }

  function clearAll() {
    photos = [];
    photosGrid.innerHTML = '';
    resetUI();
  }

  function updateSummary() {
    const n = photos.length;
    photosSummary.textContent = n
      ? `${n} ${n === 1 ? 'foto caricata' : 'foto caricate'} — l'effetto verrà applicato a tutte.`
      : '';
  }

  function showResultUI() {
    controlsSection.classList.remove('hidden');
    controlsSection.setAttribute('aria-hidden', 'false');
    gallerySection.classList.remove('hidden');
    gallerySection.setAttribute('aria-hidden', 'false');
  }

  function resetUI() {
    controlsSection.classList.add('hidden');
    controlsSection.setAttribute('aria-hidden', 'true');
    gallerySection.classList.add('hidden');
    gallerySection.setAttribute('aria-hidden', 'true');
    setStatus('');
    fileInput.value = '';
  }

  // --- Live thumbnail rendering ---

  function renderCardVintage(photo) {
    applyVintage(photo.thumbImageData, photo.thumbWidth, photo.thumbHeight, photo.canvasCtx, getEffectSettings());
  }

  function renderAllCards() {
    const settings = getEffectSettings();
    photos.forEach((photo) => {
      if (!photo.showingOriginal) {
        applyVintage(photo.thumbImageData, photo.thumbWidth, photo.thumbHeight, photo.canvasCtx, settings);
      }
    });
  }

  function scheduleRender() {
    if (!photos.length) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAllCards, 30);
  }

  // --- Full-resolution rendering for downloads ---

  function renderFullResBlob(photo, settings) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(photo.file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, MAX_DIMENSION);
          fullScratchCanvas.width = width;
          fullScratchCanvas.height = height;
          fullScratchCtx.clearRect(0, 0, width, height);
          fullScratchCtx.drawImage(img, 0, 0, width, height);
          const srcData = fullScratchCtx.getImageData(0, 0, width, height);

          applyVintage(srcData, width, height, fullOutputCtx, settings);
          fullOutputCanvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function shareOrDownload(blob, fileName) {
    const file = new File([blob], fileName, { type: 'image/jpeg' });
    const canShareFile = isMobileDevice() && navigator.canShare && navigator.canShare({ files: [file] });

    if (canShareFile) {
      try {
        await navigator.share({ files: [file], title: 'OldShot' });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        // fall through to classic download
      }
    }

    downloadBlob(blob, fileName);
  }

  async function downloadSinglePhoto(photo, buttonEl) {
    if (buttonEl) buttonEl.disabled = true;
    setStatus('Elaborazione foto…');

    const blob = await renderFullResBlob(photo, getEffectSettings());
    if (!blob) {
      setStatus('Impossibile elaborare questa foto.');
      if (buttonEl) buttonEl.disabled = false;
      return;
    }

    await shareOrDownload(blob, `oldshot-vintage-${Date.now()}.jpg`);
    setStatus('');
    if (buttonEl) buttonEl.disabled = false;
  }

  function setControlsDisabled(disabled) {
    downloadAllBtn.disabled = disabled;
    clearAllBtn.disabled = disabled;
  }

  async function downloadAllPhotos() {
    if (!photos.length || batchInProgress) return;
    batchInProgress = true;
    setControlsDisabled(true);

    const settings = getEffectSettings();
    const total = photos.length;

    try {
      if (isMobileDevice() && navigator.canShare && navigator.share) {
        const files = [];
        for (let i = 0; i < total; i++) {
          setStatus(`Elaborazione foto ${i + 1} di ${total}…`);
          const blob = await renderFullResBlob(photos[i], settings);
          if (blob) files.push(new File([blob], `oldshot-vintage-${Date.now()}-${i + 1}.jpg`, { type: 'image/jpeg' }));
        }

        if (files.length && navigator.canShare({ files })) {
          try {
            setStatus('Apertura condivisione…');
            await navigator.share({ files, title: 'OldShot' });
            setStatus('');
            return;
          } catch (err) {
            if (err && err.name === 'AbortError') {
              setStatus('');
              return;
            }
            // fall through to per-file fallback below
          }
        }

        for (let i = 0; i < files.length; i++) {
          downloadBlob(files[i], files[i].name);
          await delay(350);
        }
        setStatus(`${files.length} foto scaricate.`);
        return;
      }

      let count = 0;
      for (let i = 0; i < total; i++) {
        setStatus(`Scaricamento foto ${i + 1} di ${total}…`);
        const blob = await renderFullResBlob(photos[i], settings);
        if (blob) {
          downloadBlob(blob, `oldshot-vintage-${Date.now()}-${i + 1}.jpg`);
          count++;
          await delay(350);
        }
      }
      setStatus(`${count} foto scaricate.`);
    } finally {
      batchInProgress = false;
      setControlsDisabled(false);
    }
  }

  // --- Event wiring ---

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files && files.length) handleFiles(files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'dragend'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files && files.length) handleFiles(files);
  });

  [intensityInput, grainInput, vignetteInput].forEach((input) => {
    input.addEventListener('input', scheduleRender);
  });

  styleSepiaBtn.addEventListener('click', () => setColorMode('sepia'));
  styleBwBtn.addEventListener('click', () => setColorMode('bw'));

  clearAllBtn.addEventListener('click', clearAll);
  downloadAllBtn.addEventListener('click', downloadAllPhotos);

  // --- Scroll reveal for landing page sections ---

  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );
    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('visible'));
  }
})();
