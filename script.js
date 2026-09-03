/* Change PAGE_COUNT if pages are added or removed; numeric order is automatic. */
const PAGE_COUNT = 14;
const PAGE_IMAGES = Array.from(
  { length: PAGE_COUNT },
  (_, index) => `./Page%20-%20${index + 1}.webp`
);

const book = document.querySelector("#book");
const stage = document.querySelector("#stage");
const previousButton = document.querySelector("#previous");
const nextButton = document.querySelector("#next");
const pageStatus = document.querySelector("#pageStatus");
const mobileQuery = window.matchMedia("(max-width: 760px)");

const TURN_MS = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 220 : 640;
const DRAG_THRESHOLD = 0.24;
const CLICK_SLOP = 7;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 3;
const DOUBLE_TAP_MS = 300;

let isMobile = mobileQuery.matches;
let pageIndex = 0;
let spreadIndex = 0;
let leaves = [];
let interaction = null;
let animationTimer = 0;
let isAnimating = false;
let zoom = 1;
let panX = 0;
let panY = 0;
let pinchState = null;
let panState = null;
let zoomAnimationTimer = 0;
let tapTimer = 0;
let lastTouchTap = null;
const activePointers = new Map();

function pageFace(side, source, pageNumber) {
  const face = document.createElement("div");
  face.className = `page-face ${side}`;
  if (!source) {
    face.innerHTML = '<div class="empty-page" aria-hidden="true"></div>';
    return face;
  }

  const image = new Image();
  image.src = source;
  image.alt = `Page ${pageNumber + 1}`;
  image.draggable = false;
  face.append(image);
  return face;
}

function buildDesktop() {
  book.replaceChildren();
  leaves = [];
  const leafCount = Math.ceil(PAGE_IMAGES.length / 2);

  for (let i = 0; i < leafCount; i += 1) {
    const leaf = document.createElement("div");
    leaf.className = "leaf";
    leaf.dataset.index = String(i);
    leaf.append(
      pageFace("front", PAGE_IMAGES[i * 2], i * 2),
      pageFace("back", PAGE_IMAGES[i * 2 + 1], i * 2 + 1)
    );
    leaves.push(leaf);
    book.append(leaf);
  }

  syncDesktopLeaves();
}

function buildMobile() {
  book.replaceChildren();
  leaves = [];
  const current = document.createElement("div");
  current.className = "mobile-current";
  const image = new Image();
  image.src = PAGE_IMAGES[pageIndex];
  image.alt = `Page ${pageIndex + 1}`;
  image.draggable = false;
  current.append(image);
  book.append(current);
}

function syncDesktopLeaves() {
  leaves.forEach((leaf, index) => {
    const flipped = index < spreadIndex;
    leaf.classList.toggle("is-flipped", flipped);
    leaf.classList.remove("is-animating", "is-dragging");
    leaf.style.transform = "";
    leaf.style.zIndex = String(flipped ? index + 1 : leaves.length - index);
  });
}

function render() {
  cancelAnimation();
  interaction = null;
  book.classList.remove("is-interacting");
  if (isMobile) buildMobile();
  else buildDesktop();
  updateControls();
}

function updateControls() {
  const atStart = isMobile ? pageIndex === 0 : spreadIndex === 0;
  const atEnd = isMobile ? pageIndex === PAGE_IMAGES.length - 1 : spreadIndex === leaves.length;
  previousButton.disabled = atStart || isAnimating;
  nextButton.disabled = atEnd || isAnimating;

  if (isMobile) {
    pageStatus.textContent = `${pageIndex + 1} / ${PAGE_IMAGES.length}`;
  } else if (spreadIndex === 0) {
    pageStatus.textContent = `Cover / ${PAGE_IMAGES.length}`;
  } else if (spreadIndex === leaves.length) {
    pageStatus.textContent = `${PAGE_IMAGES.length} / ${PAGE_IMAGES.length}`;
  } else {
    const left = spreadIndex * 2;
    const right = Math.min(left + 1, PAGE_IMAGES.length);
    pageStatus.textContent = `${left}–${right} / ${PAGE_IMAGES.length}`;
  }
}

function canTurn(direction) {
  return isMobile
    ? pageIndex + direction >= 0 && pageIndex + direction < PAGE_IMAGES.length
    : spreadIndex + direction >= 0 && spreadIndex + direction <= leaves.length;
}

function applyResponsiveModeIfNeeded() {
  if (mobileQuery.matches === isMobile) return false;
  resetZoom(false);
  isMobile = mobileQuery.matches;
  if (isMobile) {
    pageIndex = spreadIndex === 0 ? 0 : Math.min(spreadIndex * 2, PAGE_IMAGES.length - 1);
  } else {
    spreadIndex = pageIndex === 0 ? 0 : Math.ceil(pageIndex / 2);
  }
  render();
  return true;
}

function cancelAnimation() {
  window.clearTimeout(animationTimer);
  animationTimer = 0;
  isAnimating = false;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function clampPan() {
  const maxX = Math.max(0, (book.offsetWidth * zoom - stage.clientWidth) / 2);
  const maxY = Math.max(0, (book.offsetHeight * zoom - stage.clientHeight) / 2);
  panX = clamp(panX, -maxX, maxX);
  panY = clamp(panY, -maxY, maxY);
}

function applyZoom(animate = false) {
  window.clearTimeout(zoomAnimationTimer);
  book.classList.toggle("is-zoom-animating", animate);
  stage.classList.toggle("is-zoomed", zoom > 1.001);
  book.style.transform = zoom > 1.001
    ? `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`
    : "";
  if (animate) {
    zoomAnimationTimer = window.setTimeout(() => {
      book.classList.remove("is-zoom-animating");
    }, 240);
  }
}

function setZoom(nextZoom, focalX, focalY, animate = false) {
  const targetZoom = clamp(nextZoom, 1, MAX_ZOOM);
  if (targetZoom === 1) {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyZoom(animate);
    return;
  }

  const bounds = stage.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const localX = (focalX - centerX - panX) / zoom;
  const localY = (focalY - centerY - panY) / zoom;
  zoom = targetZoom;
  panX = focalX - centerX - localX * zoom;
  panY = focalY - centerY - localY * zoom;
  clampPan();
  applyZoom(animate);
}

function resetZoom(animate = true) {
  setZoom(1, 0, 0, animate);
}

function pointerDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function pointerMidpoint(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

function discardPageInteraction() {
  if (!interaction) return;
  const state = interaction;
  interaction = null;
  if (!state.leaf) return;

  if (isMobile) {
    const current = book.querySelector(".mobile-current img");
    if (current) {
      current.src = PAGE_IMAGES[pageIndex];
      current.alt = `Page ${pageIndex + 1}`;
    }
    state.leaf.remove();
  } else {
    syncDesktopLeaves();
  }
}

function handleTouchTap(event, singleTapAction = null) {
  const now = performance.now();
  const isDoubleTap = lastTouchTap
    && now - lastTouchTap.time <= DOUBLE_TAP_MS
    && Math.hypot(event.clientX - lastTouchTap.x, event.clientY - lastTouchTap.y) < 36;

  if (isDoubleTap) {
    window.clearTimeout(tapTimer);
    tapTimer = 0;
    lastTouchTap = null;
    if (zoom > 1.001) resetZoom(true);
    else setZoom(DOUBLE_TAP_ZOOM, event.clientX, event.clientY, true);
    return;
  }

  lastTouchTap = { time: now, x: event.clientX, y: event.clientY };
  window.clearTimeout(tapTimer);
  if (singleTapAction) {
    tapTimer = window.setTimeout(() => {
      lastTouchTap = null;
      tapTimer = 0;
      singleTapAction();
    }, DOUBLE_TAP_MS);
  }
}

function beginPinch() {
  const points = [...activePointers.values()].slice(0, 2);
  if (points.length < 2) return;
  discardPageInteraction();
  panState = null;
  window.clearTimeout(tapTimer);
  tapTimer = 0;
  lastTouchTap = null;

  const midpoint = pointerMidpoint(points[0], points[1]);
  const bounds = stage.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  pinchState = {
    startDistance: Math.max(pointerDistance(points[0], points[1]), 1),
    startZoom: zoom,
    localX: (midpoint.x - centerX - panX) / zoom,
    localY: (midpoint.y - centerY - panY) / zoom
  };
  stage.classList.add("is-panning");
}

function updatePinch(event) {
  if (!pinchState || activePointers.size < 2) return;
  const points = [...activePointers.values()].slice(0, 2);
  const midpoint = pointerMidpoint(points[0], points[1]);
  const bounds = stage.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  zoom = clamp(
    pinchState.startZoom * pointerDistance(points[0], points[1]) / pinchState.startDistance,
    1,
    MAX_ZOOM
  );
  panX = midpoint.x - centerX - pinchState.localX * zoom;
  panY = midpoint.y - centerY - pinchState.localY * zoom;
  clampPan();
  applyZoom(false);
  event.preventDefault();
}

function finishDesktopTurn(leaf, direction, committed) {
  leaf.classList.remove("is-animating", "is-dragging");
  leaf.style.transform = "";
  if (committed) {
    spreadIndex += direction;
    pageIndex = spreadIndex === 0 ? 0 : Math.min(spreadIndex * 2, PAGE_IMAGES.length - 1);
  }
  isAnimating = false;
  syncDesktopLeaves();
  if (applyResponsiveModeIfNeeded()) return;
  updateControls();
}

function animateDesktop(direction, commit = true, startAngle = null) {
  if (isAnimating) return;
  const leafIndex = direction > 0 ? spreadIndex : spreadIndex - 1;
  const leaf = leaves[leafIndex];
  if (!leaf) return;

  isAnimating = true;
  updateControls();
  leaf.style.zIndex = "1000";
  leaf.classList.add("is-animating");
  if (startAngle !== null) leaf.style.transform = `rotateY(${startAngle}deg)`;
  void leaf.offsetWidth;

  const target = commit ? (direction > 0 ? -180 : 0) : (direction > 0 ? 0 : -180);
  leaf.style.transform = `rotateY(${target}deg)`;

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(animationTimer);
    finishDesktopTurn(leaf, direction, commit);
  };
  leaf.addEventListener("transitionend", finish, { once: true });
  animationTimer = window.setTimeout(finish, TURN_MS + 120);
}

function prepareMobileLayer(direction) {
  const destination = pageIndex + direction;
  if (destination < 0 || destination >= PAGE_IMAGES.length) return null;

  const current = book.querySelector(".mobile-current");
  const layer = document.createElement("div");
  layer.className = "leaf is-dragging";
  layer.style.zIndex = "10";

  if (direction > 0) {
    layer.append(
      pageFace("front", PAGE_IMAGES[pageIndex], pageIndex),
      pageFace("back", PAGE_IMAGES[destination], destination)
    );
    current.querySelector("img").src = PAGE_IMAGES[destination];
    current.querySelector("img").alt = `Page ${destination + 1}`;
    layer.style.transform = "rotateY(0deg)";
  } else {
    layer.append(
      pageFace("front", PAGE_IMAGES[destination], destination),
      pageFace("back", PAGE_IMAGES[pageIndex], pageIndex)
    );
    layer.style.transform = "rotateY(-180deg)";
  }

  book.append(layer);
  return layer;
}

function finishMobileTurn(layer, direction, committed) {
  const current = book.querySelector(".mobile-current");
  if (committed) pageIndex += direction;
  current.querySelector("img").src = PAGE_IMAGES[pageIndex];
  current.querySelector("img").alt = `Page ${pageIndex + 1}`;
  layer.remove();
  isAnimating = false;
  if (applyResponsiveModeIfNeeded()) return;
  updateControls();
}

function animateMobile(direction, commit = true, layer = null, startAngle = null) {
  if (isAnimating) return;
  const turnLayer = layer || prepareMobileLayer(direction);
  if (!turnLayer) return;

  isAnimating = true;
  updateControls();
  turnLayer.classList.remove("is-dragging");
  turnLayer.classList.add("is-animating");
  if (startAngle !== null) turnLayer.style.transform = `rotateY(${startAngle}deg)`;
  void turnLayer.offsetWidth;

  const target = commit ? (direction > 0 ? -180 : 0) : (direction > 0 ? 0 : -180);
  turnLayer.style.transform = `rotateY(${target}deg)`;

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(animationTimer);
    finishMobileTurn(turnLayer, direction, commit);
  };
  turnLayer.addEventListener("transitionend", finish, { once: true });
  animationTimer = window.setTimeout(finish, TURN_MS + 120);
}

function turn(direction) {
  if (isAnimating || interaction || !canTurn(direction)) return;
  if (isMobile) animateMobile(direction);
  else animateDesktop(direction);
}

function possibleDirection(clientX) {
  const bounds = book.getBoundingClientRect();
  const onLeft = clientX < bounds.left + bounds.width / 2;
  const direction = onLeft ? -1 : 1;
  return canTurn(direction) ? direction : 0;
}

function beginInteraction(event) {
  if (isAnimating || event.button > 0) return;
  const bounds = book.getBoundingClientRect();
  interaction = {
    pointerId: event.pointerId,
    direction: 0,
    leaf: null,
    startX: event.clientX,
    lastX: event.clientX,
    startedAt: performance.now(),
    bounds,
    progress: 0,
    moved: false
  };
  book.setPointerCapture(event.pointerId);
}

function moveInteraction(event) {
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  const delta = event.clientX - interaction.startX;
  if (!interaction.direction && Math.abs(delta) > CLICK_SLOP) {
    const direction = delta < 0 ? 1 : -1;
    if (!canTurn(direction)) {
      interaction.moved = true;
      return;
    }
    const leaf = isMobile
      ? prepareMobileLayer(direction)
      : leaves[direction > 0 ? spreadIndex : spreadIndex - 1];
    if (!leaf) return;
    leaf.classList.add("is-dragging");
    leaf.style.zIndex = "1000";
    interaction.direction = direction;
    interaction.leaf = leaf;
    interaction.moved = true;
  }
  if (!interaction.direction || !interaction.leaf) return;
  const signedDistance = interaction.direction > 0 ? -delta : delta;
  const progress = Math.max(0, Math.min(1, signedDistance / interaction.bounds.width));
  const angle = interaction.direction > 0 ? -180 * progress : -180 + 180 * progress;
  interaction.progress = progress;
  interaction.lastX = event.clientX;
  interaction.moved ||= Math.abs(delta) > CLICK_SLOP;
  interaction.leaf.style.transform = `rotateY(${angle}deg)`;
  if (interaction.moved) event.preventDefault();
}

function endInteraction(event) {
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  const state = interaction;
  interaction = null;

  if (book.hasPointerCapture(event.pointerId)) book.releasePointerCapture(event.pointerId);

  if (!state.direction || !state.leaf) {
    if (!state.moved) {
      const direction = possibleDirection(event.clientX);
      if (event.pointerType === "touch") {
        handleTouchTap(event, () => turn(direction));
      } else {
        turn(direction);
      }
    }
    else applyResponsiveModeIfNeeded();
    return;
  }

  const elapsed = Math.max(performance.now() - state.startedAt, 1);
  const velocity = Math.abs(state.lastX - state.startX) / elapsed;
  const commit = state.progress >= DRAG_THRESHOLD || (state.progress > 0.08 && velocity > 0.45);
  const startAngle = state.direction > 0 ? -180 * state.progress : -180 + 180 * state.progress;
  state.leaf.classList.remove("is-dragging");
  if (isMobile) animateMobile(state.direction, commit, state.leaf, startAngle);
  else animateDesktop(state.direction, commit, startAngle);
}

function cancelInteraction(event) {
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  const state = interaction;
  interaction = null;
  if (!state.direction || !state.leaf) {
    applyResponsiveModeIfNeeded();
    return;
  }
  const startAngle = state.direction > 0 ? -180 * state.progress : -180 + 180 * state.progress;
  state.leaf.classList.remove("is-dragging");
  if (isMobile) animateMobile(state.direction, false, state.leaf, startAngle);
  else animateDesktop(state.direction, false, startAngle);
}

function handlePointerDown(event) {
  if (isAnimating || event.button > 0) return;
  activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    pointerType: event.pointerType
  });
  book.setPointerCapture(event.pointerId);

  if (activePointers.size >= 2) {
    beginPinch();
    return;
  }

  if (zoom > 1.001) {
    panState = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: panX,
      startPanY: panY,
      moved: false
    };
    stage.classList.add("is-panning");
    return;
  }

  beginInteraction(event);
}

function handlePointerMove(event) {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    pointerType: event.pointerType
  });

  if (pinchState && activePointers.size >= 2) {
    updatePinch(event);
    return;
  }

  if (panState && panState.pointerId === event.pointerId && zoom > 1.001) {
    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;
    panState.moved ||= Math.hypot(deltaX, deltaY) > CLICK_SLOP;
    panX = panState.startPanX + deltaX;
    panY = panState.startPanY + deltaY;
    clampPan();
    applyZoom(false);
    event.preventDefault();
    return;
  }

  moveInteraction(event);
  if (interaction?.moved) {
    window.clearTimeout(tapTimer);
    tapTimer = 0;
    lastTouchTap = null;
  }
}

function releasePointer(event) {
  if (book.hasPointerCapture(event.pointerId)) {
    book.releasePointerCapture(event.pointerId);
  }
}

function handlePointerUp(event) {
  if (!activePointers.has(event.pointerId)) return;

  if (pinchState) {
    activePointers.delete(event.pointerId);
    releasePointer(event);
    if (activePointers.size < 2) {
      pinchState = null;
      stage.classList.remove("is-panning");
      if (zoom <= 1.01) {
        resetZoom(true);
      } else if (activePointers.size === 1) {
        const [pointerId, point] = activePointers.entries().next().value;
        panState = {
          pointerId,
          pointerType: point.pointerType,
          startX: point.x,
          startY: point.y,
          startPanX: panX,
          startPanY: panY,
          moved: true
        };
        stage.classList.add("is-panning");
      }
    }
    if (activePointers.size === 0) applyResponsiveModeIfNeeded();
    return;
  }

  if (panState && panState.pointerId === event.pointerId) {
    const state = panState;
    panState = null;
    activePointers.delete(event.pointerId);
    releasePointer(event);
    stage.classList.remove("is-panning");
    if (!state.moved && state.pointerType === "touch") {
      handleTouchTap(event);
    }
    applyResponsiveModeIfNeeded();
    return;
  }

  endInteraction(event);
  activePointers.delete(event.pointerId);
  applyResponsiveModeIfNeeded();
}

function handlePointerCancel(event) {
  activePointers.delete(event.pointerId);
  if (interaction?.pointerId === event.pointerId) cancelInteraction(event);
  if (panState?.pointerId === event.pointerId) panState = null;
  if (activePointers.size < 2) pinchState = null;
  if (activePointers.size === 0) stage.classList.remove("is-panning");
  releasePointer(event);
  if (activePointers.size === 0) applyResponsiveModeIfNeeded();
}

previousButton.addEventListener("click", () => turn(-1));
nextButton.addEventListener("click", () => turn(1));
book.addEventListener("pointerdown", handlePointerDown);
book.addEventListener("pointermove", handlePointerMove, { passive: false });
book.addEventListener("pointerup", handlePointerUp);
book.addEventListener("pointercancel", handlePointerCancel);
book.addEventListener("contextmenu", (event) => event.preventDefault());
book.addEventListener("dragstart", (event) => event.preventDefault());
book.addEventListener("gesturestart", (event) => event.preventDefault());

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    turn(1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    turn(-1);
  }
});

mobileQuery.addEventListener("change", (event) => {
  if (interaction || isAnimating || activePointers.size) return;
  applyResponsiveModeIfNeeded();
});

window.addEventListener("resize", () => {
  if (zoom <= 1.001) return;
  clampPan();
  applyZoom(false);
});

PAGE_IMAGES.forEach((source) => {
  const image = new Image();
  image.src = source;
});

render();
