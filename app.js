(() => {
  'use strict';

  const MAX_DIMENSION = 2000;

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const controlsSection = document.getElementById('controls-section');
  const previewSection = document.getElementById('preview-section');
  const canvasOriginal = document.getElementById('canvas-original');
  const canvasVintage = document.getElementById('canvas-vintage');
  const canvasWork = document.getElementById('canvas-work');
  const resetBtn = document.getElementById('reset-btn');
  const downloadBtn = document.getElementById('download-btn');
  const statusMsg = document.getElementById('status-msg');
  const processingOverlay = document.getElementById('processing-overlay');
  const intensityInput = document.getElementById('intensity');
  const grainInput = document.getElementById('grain');
  const vignetteInput = document.getElementById('vignette');

  const ctxOriginal = canvasOriginal.getContext('2d');
  const ctxVintage = canvasVintage.getContext('2d');
  const ctxWork = canvasWork.getContext('2d');

  let sourceImage = null; // holds the resized original ImageData source (as canvas)
  let renderTimer = null;

  function setStatus(msg) {
    statusMsg.textContent = msg || '';
  }

  function setProcessing(isProcessing) {
    processingOverlay.classList.toggle('hidden', !isProcessing);
  }

  function showResultUI() {
    controlsSection.classList.remove('hidden');
    controlsSection.setAttribute('aria-hidden', 'false');
    previewSection.classList.remove('hidden');
    previewSection.setAttribute('aria-hidden', 'false');
  }

  function resetUI() {
    controlsSection.classList.add('hidden');
    controlsSection.setAttribute('aria-hidden', 'true');
    previewSection.classList.add('hidden');
    previewSection.setAttribute('aria-hidden', 'true');
    setStatus('');
    sourceImage = null;
    fileInput.value = '';
  }

  function loadImageFromFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      setStatus('Seleziona un file immagine valido.');
      return;
    }

    setStatus('Caricamento immagine…');

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      handleLoadedImage(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setStatus('Impossibile leggere questa immagine. Riprova con un altro file.');
    };
    img.src = objectUrl;
  }

  function handleLoadedImage(img) {
    let { width, height } = img;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    canvasWork.width = width;
    canvasWork.height = height;
    ctxWork.clearRect(0, 0, width, height);
    ctxWork.drawImage(img, 0, 0, width, height);

    sourceImage = ctxWork.getImageData(0, 0, width, height);

    canvasOriginal.width = width;
    canvasOriginal.height = height;
    ctxOriginal.putImageData(sourceImage, 0, 0);

    canvasVintage.width = width;
    canvasVintage.height = height;

    showResultUI();
    setStatus('');
    scheduleRender();
  }

  function scheduleRender() {
    if (!sourceImage) return;
    clearTimeout(renderTimer);
    setProcessing(true);
    renderTimer = setTimeout(applyVintageEffect, 30);
  }

  function applyVintageEffect() {
    if (!sourceImage) {
      setProcessing(false);
      return;
    }

    const { width, height } = sourceImage;
    const intensity = Number(intensityInput.value) / 100;
    const grainAmount = Number(grainInput.value) / 100;
    const vignetteAmount = Number(vignetteInput.value) / 100;

    const imageData = ctxWork.createImageData(width, height);
    const src = sourceImage.data;
    const out = imageData.data;

    // Reduced contrast factor (pulls midtones toward gray)
    const contrastFactor = 1 - 0.35 * intensity;
    const midpoint = 128;

    for (let i = 0; i < src.length; i += 4) {
      let r = src[i];
      let g = src[i + 1];
      let b = src[i + 2];
      const a = src[i + 3];

      // Reduced contrast
      r = (r - midpoint) * contrastFactor + midpoint;
      g = (g - midpoint) * contrastFactor + midpoint;
      b = (b - midpoint) * contrastFactor + midpoint;

      // Sepia tone
      const sr = r * 0.393 + g * 0.769 + b * 0.189;
      const sg = r * 0.349 + g * 0.686 + b * 0.168;
      const sb = r * 0.272 + g * 0.534 + b * 0.131;

      r = r + (sr - r) * intensity;
      g = g + (sg - g) * intensity;
      b = b + (sb - b) * intensity;

      out[i] = clamp(r);
      out[i + 1] = clamp(g);
      out[i + 2] = clamp(b);
      out[i + 3] = a;
    }

    // Grain
    if (grainAmount > 0) {
      const grainStrength = grainAmount * 45;
      for (let i = 0; i < out.length; i += 4) {
        const noise = (Math.random() - 0.5) * grainStrength;
        out[i] = clamp(out[i] + noise);
        out[i + 1] = clamp(out[i + 1] + noise);
        out[i + 2] = clamp(out[i + 2] + noise);
      }
    }

    ctxWork.putImageData(imageData, 0, 0);

    ctxVintage.clearRect(0, 0, width, height);
    ctxVintage.drawImage(canvasWork, 0, 0);

    // Vignette
    if (vignetteAmount > 0) {
      const cx = width / 2;
      const cy = height / 2;
      const outerRadius = Math.sqrt(cx * cx + cy * cy);
      const gradient = ctxVintage.createRadialGradient(
        cx, cy, outerRadius * (1 - vignetteAmount * 0.7) * 0.3,
        cx, cy, outerRadius
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(0,0,0,${0.75 * vignetteAmount})`);
      ctxVintage.fillStyle = gradient;
      ctxVintage.fillRect(0, 0, width, height);
    }

    setProcessing(false);
  }

  function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function triggerDownload() {
    canvasVintage.toBlob((blob) => {
      if (!blob) {
        setStatus('Impossibile generare il file da scaricare.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `oldshot-vintage-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/jpeg', 0.92);
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
    const file = e.target.files && e.target.files[0];
    if (file) loadImageFromFile(file);
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
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadImageFromFile(file);
  });

  [intensityInput, grainInput, vignetteInput].forEach((input) => {
    input.addEventListener('input', scheduleRender);
  });

  resetBtn.addEventListener('click', resetUI);
  downloadBtn.addEventListener('click', triggerDownload);

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
