// Image Gallery Animation System (extracted from index.html)
(function () {
  const galleryCanvas = document.getElementById('galleryCanvas');
  if (!galleryCanvas) return;
  const galleryCtx = galleryCanvas.getContext('2d');

  let animatingImages = [];
  let loadedImages = 0;
  let totalImages = 0;
  let occupiedAreas = [];
  let initialAnimationCompleted = false;
  let fadeOutStarted = false;
  let animationFrameId = null;

  const ANIMATION_DURATION = 800;
  const MIN_SCALE = 0.15;
  const INITIAL_SCALE_MIN = 0.3;
  const INITIAL_SCALE_MAX = 0.5;
  const BUFFER = 15;
  const MAX_ATTEMPTS = 50;
  const BASE_ALPHA = 0.85;
  const HOVER_SCALE_FACTOR = 1.08;
  const FADE_OUT_DURATION = 350;
  const FADE_OUT_STAGGER = 50;
  const SAFE_ZONE = { width: 300, height: 300 };

  function resizeGalleryCanvas() {
    galleryCanvas.width = window.innerWidth;
    galleryCanvas.height = window.innerHeight;
  }

  resizeGalleryCanvas();
  window.addEventListener('resize', resizeGalleryCanvas);

  class AnimatedImage {
    constructor(image, imageUrl, originalUrl, sizeMultiplier = 1, delay = 0) {
      this.image = image;
      this.imageUrl = imageUrl;
      this.originalUrl = originalUrl;
      this.sizeMultiplier = sizeMultiplier;

      const baseScale = INITIAL_SCALE_MIN + Math.random() * (INITIAL_SCALE_MAX - INITIAL_SCALE_MIN);
      this.targetScale = baseScale * this.sizeMultiplier;

      const placement = this.findPlacement();
      this.targetX = placement.x;
      this.targetY = placement.y;
      this.targetScale = placement.scale;

      this.width = this.image.width * this.targetScale;
      this.height = this.image.height * this.targetScale;

      this.scale = 0.01;
      this.alpha = 0;
      this.targetAlpha = BASE_ALPHA;
      this.rotation = (Math.random() - 0.5) * 0.3;

      this.startTime = null;
      this.delay = delay;
      this.animationComplete = false;
      this.isHovered = false;
      this.hoverScaleFactor = HOVER_SCALE_FACTOR;
      this.x = galleryCanvas.width / 2;
      this.y = galleryCanvas.height / 2;
      this.hoverProgress = 0;
      this.fadeOutProgress = 0;
      this.fadeOutScheduled = false;
      this.fadeOutStartTime = null;
      this.fadeOutTriggerTime = null;
      this.fadeOutDuration = FADE_OUT_DURATION;
      this.fadeOutComplete = false;
    }

    isInSafeZone(x, y, width, height) {
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      const left = x - halfWidth;
      const right = x + halfWidth;
      const top = y - halfHeight;
      const bottom = y + halfHeight;

      const safeLeft = (galleryCanvas.width - SAFE_ZONE.width) / 2;
      const safeRight = safeLeft + SAFE_ZONE.width;
      const safeTop = (galleryCanvas.height - SAFE_ZONE.height) / 2;
      const safeBottom = safeTop + SAFE_ZONE.height;

      return !(right < safeLeft || left > safeRight || bottom < safeTop || top > safeBottom);
    }

    findPlacement() {
      let currentScale = this.targetScale;
      let bestPlacement = null;
      let attempts = 0;
      const minAllowedScale = MIN_SCALE * this.sizeMultiplier;

      const margin = 50;
      const availableWidth = galleryCanvas.width - 2 * margin;
      const availableHeight = galleryCanvas.height - 2 * margin;

      const idealArea = (availableWidth * availableHeight) / (totalImages * 1.5);
      const idealScale = Math.sqrt(idealArea / (this.image.width * this.image.height));
      currentScale = Math.min(idealScale, this.targetScale);

      while (attempts < MAX_ATTEMPTS && !bestPlacement) {
        const width = this.image.width * currentScale;
        const height = this.image.height * currentScale;

        for (let i = 0; i < 10; i++) {
          const x = margin + Math.random() * (galleryCanvas.width - 2 * margin);
          const y = margin + Math.random() * (galleryCanvas.height - 2 * margin);

          if (!this.isInSafeZone(x, y, width, height) && !this.checkOverlap(x, y, width, height)) {
            bestPlacement = { x, y, scale: currentScale };
            break;
          }
        }

        if (!bestPlacement) {
          currentScale *= 0.9;
          if (currentScale < minAllowedScale) {
            const gridPosition = this.getGridPosition();
            bestPlacement = { x: gridPosition.x, y: gridPosition.y, scale: minAllowedScale };
            break;
          }
        }
        attempts++;
      }

      if (!bestPlacement) {
        const gridPosition = this.getGridPosition();
        bestPlacement = { x: gridPosition.x, y: gridPosition.y, scale: minAllowedScale };
      }
      return bestPlacement;
    }

    getGridPosition() {
      const rows = Math.ceil(Math.sqrt(totalImages));
      const cols = rows;
      const index = animatingImages.length;
      const row = Math.floor(index / cols);
      const col = index % cols;
      const margin = 60;
      const cellWidth = (galleryCanvas.width - margin * 2) / cols;
      const cellHeight = (galleryCanvas.height - margin * 2) / rows;
      const x = margin + col * cellWidth + cellWidth / 2;
      const y = margin + row * cellHeight + cellHeight / 2;
      return { x, y };
    }

    checkOverlap(x, y, width, height) {
      const left = x - width / 2 - BUFFER;
      const right = x + width / 2 + BUFFER;
      const top = y - height / 2 - BUFFER;
      const bottom = y + height / 2 + BUFFER;
      for (const rect of occupiedAreas) {
        if (!(right < rect.left || left > rect.right || bottom < rect.top || top > rect.bottom)) {
          return true;
        }
      }
      return false;
    }

    update(timestamp) {
      if (!this.startTime) {
        this.startTime = timestamp + this.delay;
      }
      if (timestamp < this.startTime) {
        return;
      }
      const progress = Math.min(1, (timestamp - this.startTime) / ANIMATION_DURATION);
      const ease = 1 - Math.pow(1 - progress, 3);
      this.scale = 0.01 + (this.targetScale - 0.01) * ease;
      this.alpha = this.targetAlpha * ease;
      this.x += (this.targetX - this.x) * 0.08;
      this.y += (this.targetY - this.y) * 0.08;
      if (Math.abs(this.x - this.targetX) < 0.5 && Math.abs(this.y - this.targetY) < 0.5) {
        this.x = this.targetX;
        this.y = this.targetY;
        this.animationComplete = true;
      }

      if (this.fadeOutScheduled) {
        if (this.fadeOutStartTime === null) {
          const now = performance.now();
          if (now >= this.fadeOutTriggerTime) {
            this.fadeOutStartTime = now;
          }
        }
        if (this.fadeOutStartTime !== null) {
          const now = performance.now();
          const fadeProgress = Math.min(1, (now - this.fadeOutStartTime) / this.fadeOutDuration);
          this.fadeOutProgress = fadeProgress;
          const easeFade = 1 - Math.pow(1 - fadeProgress, 3);
          this.alpha = this.targetAlpha * (1 - easeFade);
          this.scale = this.targetScale * (1 - 0.2 * easeFade);
          if (fadeProgress >= 1) {
            this.fadeOutComplete = true;
          }
        }
      }
    }

    draw() {
      const width = this.image.width * this.scale;
      const height = this.image.height * this.scale;
      const x = this.x - width / 2;
      const y = this.y - height / 2;
      const angle = this.rotation * (1 + this.hoverProgress * (this.hoverScaleFactor - 1));
      galleryCtx.save();
      galleryCtx.globalAlpha = this.alpha;
      galleryCtx.translate(this.x, this.y);
      galleryCtx.rotate(angle);
      galleryCtx.drawImage(this.image, -width / 2, -height / 2, width, height);
      galleryCtx.restore();
    }

    containsPoint(x, y) {
      if (!this.animationComplete) return false;
      const hoverScaleBoost = 1 + (this.hoverScaleFactor - 1) * this.hoverProgress;
      const effectiveScale = this.scale * hoverScaleBoost;
      const width = this.image.width * effectiveScale;
      const height = this.image.height * effectiveScale;
      const left = this.x - width / 2;
      const top = this.y - height / 2;
      return x >= left && x <= left + width && y >= top && y <= top + height;
    }

    startFadeOut(triggerTime, duration = FADE_OUT_DURATION) {
      this.fadeOutScheduled = true;
      const resolvedTrigger = typeof triggerTime === 'number' ? triggerTime : performance.now();
      this.fadeOutTriggerTime = resolvedTrigger;
      this.fadeOutDuration = duration;
      this.fadeOutStartTime = null;
      this.fadeOutProgress = 0;
      this.fadeOutComplete = false;
      this.isHovered = false;
    }

    setHovered(isHovered) {
      if (this.fadeOutProgress >= 1) {
        this.isHovered = false;
        return;
      }
      this.isHovered = isHovered;
    }
  }

  function animate(timestamp) {
    galleryCtx.clearRect(0, 0, galleryCanvas.width, galleryCanvas.height);

    let allComplete = true;
    for (const img of animatingImages) {
      img.update(timestamp);
      if (!img.animationComplete) {
        allComplete = false;
      }
      img.draw();
    }

    if (allComplete && !initialAnimationCompleted) {
      initialAnimationCompleted = true;
    }

    const allFadedOut = animatingImages.length > 0 && animatingImages.every(img => img.fadeOutComplete);
    if (allFadedOut) {
      galleryCanvas.style.display = 'none';
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      return;
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  function loadImages(imagesData) {
    animatingImages = [];
    occupiedAreas = [];
    loadedImages = 0;
    totalImages = imagesData.length;
    initialAnimationCompleted = false;
    fadeOutStarted = false;
    updateHoverState(null);
    galleryCanvas.style.cursor = 'default';
    galleryCanvas.style.display = 'block';

    if (totalImages === 0) {
      console.log('No images received');
      return;
    }

    const shuffled = [...imagesData].sort(() => Math.random() - 0.5);
    let allImagesLoaded = false;

    shuffled.forEach((item, index) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        loadedImages++;
        console.log(`Loaded ${loadedImages}/${totalImages} images`);
        const delay = index * 60;
        const sizeMultiplier = ((index + 1) % 3 === 0) ? 1.25 : 1;
        const animatedImg = new AnimatedImage(img, item.thumbnail, item.original, sizeMultiplier, delay);
        animatingImages.push(animatedImg);
        if (loadedImages === totalImages && !allImagesLoaded) {
          allImagesLoaded = true;
          if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(animate);
          }
        }
      };

      img.onerror = () => {
        loadedImages++;
        console.log(`Failed to load image ${loadedImages}/${totalImages}`);
        if (loadedImages === totalImages && !allImagesLoaded) {
          allImagesLoaded = true;
          if (!animationFrameId && animatingImages.length > 0) {
            animationFrameId = requestAnimationFrame(animate);
          }
        }
      };

      img.src = item.thumbnail;
    });
  }

  function fadeOutSequentially() {
    if (fadeOutStarted) return;
    fadeOutStarted = true;
    updateHoverState(null);
    const startTime = performance.now();
    animatingImages.forEach((img, index) => {
      const trigger = startTime + index * FADE_OUT_STAGGER;
      img.startFadeOut(trigger, FADE_OUT_DURATION);
    });
  }

  function getCanvasCoordinates(event) {
    const rect = galleryCanvas.getBoundingClientRect();
    const scaleX = galleryCanvas.width / rect.width;
    const scaleY = galleryCanvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function findImageAtPoint(x, y) {
    for (let i = animatingImages.length - 1; i >= 0; i--) {
      const img = animatingImages[i];
      if (!img.animationComplete) continue;
      if (img.containsPoint(x, y)) return img;
    }
    return null;
  }

  function updateHoverState(targetImage) {
    animatingImages.forEach(img => img.setHovered(img === targetImage));
    galleryCanvas.style.cursor = targetImage ? 'pointer' : 'default';
  }

  function handlePointerMove(event) {
    if (fadeOutStarted) {
      updateHoverState(null);
      return;
    }
    const { x, y } = getCanvasCoordinates(event);
    const hovered = findImageAtPoint(x, y);
    updateHoverState(hovered);
  }

  function handlePointerLeave() {
    updateHoverState(null);
  }

  function handleClick(event) {
    if (fadeOutStarted) return;
    const { x, y } = getCanvasCoordinates(event);
    const target = findImageAtPoint(x, y);
    if (target && target.originalUrl) {
      openImageModal(target.originalUrl);
    }
  }

  let currentModalImageIndex = -1;
  let availableModalImages = [];

  function openImageModal(imageUrl) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    availableModalImages = animatingImages.filter(img =>
      img.fadeOutProgress < 0.5 && img.animationComplete && img.originalUrl
    );
    currentModalImageIndex = availableModalImages.findIndex(img => img.originalUrl === imageUrl);
    if (currentModalImageIndex === -1) {
      availableModalImages = [];
      currentModalImageIndex = -1;
    }
    if (modalImg) modalImg.src = imageUrl;
    modal && modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeImageModal() {
    const modal = document.getElementById('imageModal');
    modal && modal.classList.remove('show');
    currentModalImageIndex = -1;
    availableModalImages = [];
    document.body.style.overflow = '';
  }

  function showNextImage() {
    if (availableModalImages.length === 0 || currentModalImageIndex === -1) return;
    currentModalImageIndex = (currentModalImageIndex + 1) % availableModalImages.length;
    const nextImage = availableModalImages[currentModalImageIndex];
    const modalImg = document.getElementById('modalImage');
    if (modalImg) modalImg.src = nextImage.originalUrl;
  }

  function showPreviousImage() {
    if (availableModalImages.length === 0 || currentModalImageIndex === -1) return;
    currentModalImageIndex = (currentModalImageIndex - 1 + availableModalImages.length) % availableModalImages.length;
    const prevImage = availableModalImages[currentModalImageIndex];
    const modalImg = document.getElementById('modalImage');
    if (modalImg) modalImg.src = prevImage.originalUrl;
  }

  galleryCanvas.addEventListener('mousemove', handlePointerMove);
  galleryCanvas.addEventListener('mouseleave', handlePointerLeave);
  galleryCanvas.addEventListener('click', handleClick);

  const closeModalBtn = document.getElementById('closeModal');
  const imageModal = document.getElementById('imageModal');
  closeModalBtn && closeModalBtn.addEventListener('click', closeImageModal);
  imageModal && imageModal.addEventListener('click', function (event) {
    if (event.target === imageModal) closeImageModal();
  });

  document.addEventListener('keydown', function (event) {
    const modal = document.getElementById('imageModal');
    const isModalOpen = !!(modal && modal.classList.contains('show'));
    if (event.key === 'Escape') {
      if (isModalOpen) {
        closeImageModal();
      } else if (window.imageGallery && window.imageGallery.fadeOutSequentially) {
        window.imageGallery.fadeOutSequentially();
      }
      return;
    }
    if (!isModalOpen) return;
    switch (event.key) {
      case 'ArrowLeft': event.preventDefault(); showPreviousImage(); break;
      case 'ArrowRight': event.preventDefault(); showNextImage(); break;
    }
  });

  function pickRandomCard() {
    if (animatingImages.length === 0) {
      console.log('No images in gallery to pick');
      return { success: false };
    }
    const availableImages = animatingImages.filter(img =>
      img.fadeOutProgress < 0.5 && img.animationComplete
    );
    if (availableImages.length === 0) {
      console.log('No available images to pick (all faded out or still animating)');
      return { success: false };
    }
    const randomIndex = Math.floor(Math.random() * availableImages.length);
    const selectedImage = availableImages[randomIndex];
    const comments = [
      "this one is interesting",
      "that's a unique one",
      "this one caught my eye",
      "here's a good one",
      "oh, I like this one. It stands out",
      "this one looks particularly nice",
      "let me show you this one. It's quite striking",
      "here's a fascinating one I found",
      "this one has something special about it",
      "I think you'll like this one. It's captivating",
      "oh, this is a great choice. Very interesting",
      "look at this one. Pretty remarkable",
      "here's one that really stands out",
      "this caught my attention. Take a look",
      "found a good one here. Check this out",
      "this one's worth seeing. Quite unique",
      "I'll pick this one for you. It's excellent",
      "here you go. This one's particularly striking",
      "oh, definitely this one. It's intriguing",
      "take a look at this. Very compelling",
      "this one here. I think it's the most interesting",
      "found something good. This one's worth your time",
      "let's go with this one. Really catches the eye",
      "here's my pick. It has a certain quality to it",
      "this one right here. Pretty impressive"
    ];
    const randomComment = comments[Math.floor(Math.random() * comments.length)];
    selectedImage.setHovered(true);
    setTimeout(() => {
      if (selectedImage.originalUrl) openImageModal(selectedImage.originalUrl);
      selectedImage.setHovered(false);
    }, 300);
    return { success: true, comment: randomComment };
  }

  function hasVisibleImages() {
    return animatingImages.length > 0 && !animatingImages.every(img => img.fadeOutComplete) && galleryCanvas.style.display !== 'none';
  }

  window.imageGallery = {
    loadImages,
    fadeOutSequentially,
    pickRandomCard,
    openImageModal,
    closeImageModal,
    showNextImage,
    showPreviousImage,
    hasVisibleImages
  };
})();

