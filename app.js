(() => {
  'use strict';

  const MAX_DIMENSION = 2000; // cap for full-resolution processing / download
  const THUMB_MAX = 560; // cap for the fast live-preview thumbnails
  const LIGHTBOX_MAX = 1600; // cap for the fullscreen preview
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
  const lightbox = document.getElementById('lightbox');
  const lightboxStage = document.getElementById('lightbox-stage');
  const lightboxCanvas = document.getElementById('lightbox-canvas');
  const lightboxLoading = document.getElementById('lightbox-loading');
  const lightboxCloseBtn = document.getElementById('lightbox-close');
  const lightboxPrevBtn = document.getElementById('lightbox-prev');
  const lightboxNextBtn = document.getElementById('lightbox-next');
  const lightboxToggleBtn = document.getElementById('lightbox-toggle-btn');
  const lightboxDownloadBtn = document.getElementById('lightbox-download-btn');

  // Offscreen canvases used purely as scratch space, never attached to the DOM.
  const thumbScratchCanvas = document.createElement('canvas');
  const thumbScratchCtx = thumbScratchCanvas.getContext('2d');
  const fullScratchCanvas = document.createElement('canvas');
  const fullScratchCtx = fullScratchCanvas.getContext('2d');
  const fullOutputCanvas = document.createElement('canvas');
  const fullOutputCtx = fullOutputCanvas.getContext('2d');
  const lightboxScratchCanvas = document.createElement('canvas');
  const lightboxScratchCtx = lightboxScratchCanvas.getContext('2d');
  const lightboxCtx = lightboxCanvas.getContext('2d');

  let photos = [];
  let nextPhotoId = 0;
  let renderTimer = null;
  let batchInProgress = false;
  let colorMode = 'sepia'; // 'sepia' | 'bw'
  let lightboxIndex = -1;
  let lightboxRenderToken = 0;

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

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image load failed'));
      };
      img.src = url;
    });
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
    if (lightboxIndex !== -1 && !photos[lightboxIndex].showingOriginal) renderLightboxPhoto();
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
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', 'Ingrandisci questa foto a schermo intero');
    photo.canvasCtx = canvas.getContext('2d');
    photo.canvasCtx.putImageData(photo.thumbImageData, 0, 0);

    const openThisLightbox = () => openLightbox(photo.id);
    canvas.addEventListener('click', openThisLightbox);
    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openThisLightbox();
      }
    });

    const zoomHint = document.createElement('span');
    zoomHint.className = 'zoom-hint';
    zoomHint.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 8v6M8 11h6" stroke-linecap="round"/></svg>';

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

    canvasWrap.append(canvas, removeBtn, tag, zoomHint);

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

  function updateCardView(photo) {
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

  function toggleOriginal(photo) {
    photo.showingOriginal = !photo.showingOriginal;
    updateCardView(photo);
    if (lightboxIndex !== -1 && photos[lightboxIndex] === photo) {
      renderLightboxPhoto();
    }
  }

  function removePhoto(id) {
    // The lightbox overlay covers the grid while open, so its remove button
    // can't be reached; closing defensively here just guards future call sites.
    if (lightboxIndex !== -1) closeLightbox();

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
    closeLightbox();
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
    renderTimer = setTimeout(() => {
      renderAllCards();
      if (lightboxIndex !== -1 && !photos[lightboxIndex].showingOriginal) renderLightboxPhoto();
    }, 30);
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

  // --- Fullscreen lightbox ---

  function updateLightboxNavVisibility() {
    const multi = photos.length > 1;
    lightboxPrevBtn.classList.toggle('hidden', !multi);
    lightboxNextBtn.classList.toggle('hidden', !multi);
  }

  function openLightbox(photoId) {
    const idx = photos.findIndex((p) => p.id === photoId);
    if (idx === -1) return;
    lightboxIndex = idx;
    lightbox.classList.remove('hidden');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-open');
    updateLightboxNavVisibility();
    renderLightboxPhoto();
  }

  function closeLightbox() {
    if (lightboxIndex === -1) return;
    lightboxIndex = -1;
    lightboxRenderToken++;
    lightbox.classList.add('hidden');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-open');
  }

  function lightboxNext() {
    if (photos.length < 2) return;
    lightboxIndex = (lightboxIndex + 1) % photos.length;
    renderLightboxPhoto();
  }

  function lightboxPrev() {
    if (photos.length < 2) return;
    lightboxIndex = (lightboxIndex - 1 + photos.length) % photos.length;
    renderLightboxPhoto();
  }

  async function renderLightboxPhoto() {
    const photo = photos[lightboxIndex];
    if (!photo) return;

    lightboxToggleBtn.textContent = photo.showingOriginal ? 'Vintage' : 'Originale';
    lightboxLoading.classList.remove('hidden');

    const token = ++lightboxRenderToken;
    const settings = getEffectSettings();

    let img;
    try {
      img = await loadImageElement(photo.file);
    } catch (err) {
      if (token === lightboxRenderToken) {
        lightboxLoading.classList.add('hidden');
        setStatus('Impossibile caricare l\'anteprima di questa foto.');
      }
      return;
    }

    if (token !== lightboxRenderToken) return; // closed or navigated away meanwhile

    const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, LIGHTBOX_MAX);

    if (photo.showingOriginal) {
      lightboxCanvas.width = width;
      lightboxCanvas.height = height;
      lightboxCtx.clearRect(0, 0, width, height);
      lightboxCtx.drawImage(img, 0, 0, width, height);
    } else {
      lightboxScratchCanvas.width = width;
      lightboxScratchCanvas.height = height;
      lightboxScratchCtx.clearRect(0, 0, width, height);
      lightboxScratchCtx.drawImage(img, 0, 0, width, height);
      const srcData = lightboxScratchCtx.getImageData(0, 0, width, height);
      applyVintage(srcData, width, height, lightboxCtx, settings);
    }

    lightboxLoading.classList.add('hidden');
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

  lightboxCloseBtn.addEventListener('click', closeLightbox);
  lightboxPrevBtn.addEventListener('click', lightboxPrev);
  lightboxNextBtn.addEventListener('click', lightboxNext);

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  lightboxToggleBtn.addEventListener('click', () => {
    const photo = photos[lightboxIndex];
    if (photo) toggleOriginal(photo);
  });

  lightboxDownloadBtn.addEventListener('click', () => {
    const photo = photos[lightboxIndex];
    if (photo) downloadSinglePhoto(photo, lightboxDownloadBtn);
  });

  document.addEventListener('keydown', (e) => {
    if (lightboxIndex === -1) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') lightboxNext();
    else if (e.key === 'ArrowLeft') lightboxPrev();
  });

  let lightboxTouchStartX = null;
  lightboxStage.addEventListener('touchstart', (e) => {
    lightboxTouchStartX = e.touches[0].clientX;
  }, { passive: true });
  lightboxStage.addEventListener('touchend', (e) => {
    if (lightboxTouchStartX === null) return;
    const dx = e.changedTouches[0].clientX - lightboxTouchStartX;
    lightboxTouchStartX = null;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) lightboxNext();
    else lightboxPrev();
  });

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
