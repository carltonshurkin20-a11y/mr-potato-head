/* global $ */

// the parts in the images folder were cut to fit a 170px wide potato, the potato on screen is 340px
const SCALE = 2;

const $container = $('#container');
const $trash = $('#trash');
const $sidebar = $('#sidebar');

let draggee = null;
let offset;
let topZ = 10; // goes up every time a piece is picked up so it lands on top of everything

// =====================================================================
// dragging
// =====================================================================

// mousedown on a sidebar part makes a new copy of it, so a part can be used more than once
$('.part').on('mousedown', e => {
  e.preventDefault();

  const img = $(e.currentTarget).find('img')[0];
  const width = img.naturalWidth * SCALE;
  const height = img.naturalHeight * SCALE;
  const box = $container[0].getBoundingClientRect();

  // start with the middle of the new piece under the mouse
  const $piece = addPiece({
    src: img.getAttribute('src'),
    left: e.clientX - box.left - width / 2,
    top: e.clientY - box.top - height / 2,
    width,
    rotate: 0,
    z: topZ // startDrag raises it to the top
  });

  startDrag($piece, e);
});

// mousedown on a piece that's already on the potato picks it up again
$container.on('mousedown', '.piece', e => {
  e.preventDefault();
  startDrag($(e.currentTarget), e);
});

function startDrag($piece, e) {
  const box = $container[0].getBoundingClientRect();

  // where in the piece the mouse grabbed it (style.left/top rather than getBoundingClientRect
  // because getBoundingClientRect is thrown off when the piece is rotated)
  offset = {
    x: e.clientX - box.left - parseFloat($piece[0].style.left),
    y: e.clientY - box.top - parseFloat($piece[0].style.top)
  };

  draggee = $piece;
  draggee.css('z-index', ++topZ).addClass('dragging');

  $(window).on('mousemove', handleMouseMove).on('mouseup', handleMouseUp);
}

function handleMouseMove(e) {
  const box = $container[0].getBoundingClientRect();

  draggee.css({
    left: e.clientX - box.left - offset.x,
    top: e.clientY - box.top - offset.y
  });

  $trash.toggleClass('open', isOver($trash, e));
}

function handleMouseUp(e) {
  $(window).off('mousemove', handleMouseMove).off('mouseup', handleMouseUp);

  // dropped on the trash or back on the sidebar, throw it away
  if (isOver($trash, e) || isOver($sidebar, e)) {
    draggee.remove();
  } else {
    draggee.removeClass('dragging');
  }

  $trash.removeClass('open');
  draggee = null;
  saveCurrent();
}

function isOver($element, e) {
  const rect = $element[0].getBoundingClientRect();
  return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
}

// =====================================================================
// resize (mouse wheel) and rotate (double click)
// =====================================================================

$container.on('wheel', '.piece', e => {
  e.preventDefault();

  const piece = e.currentTarget;
  const oldWidth = piece.offsetWidth;
  const oldHeight = piece.offsetHeight;
  const grow = e.originalEvent.deltaY < 0 ? 1.1 : 0.9;
  const newWidth = Math.min(Math.max(oldWidth * grow, 20), 700);
  const newHeight = oldHeight * newWidth / oldWidth;

  // move it so it grows from its middle instead of its top left corner
  $(piece).css({
    width: newWidth,
    left: parseFloat(piece.style.left) - (newWidth - oldWidth) / 2,
    top: parseFloat(piece.style.top) - (newHeight - oldHeight) / 2
  });

  saveCurrent();
});

$container.on('dblclick', '.piece', e => {
  const $piece = $(e.currentTarget);
  setRotate($piece, ($piece.data('rotate') + 15) % 360);
  saveCurrent();
});

function setRotate($piece, degrees) {
  $piece.data('rotate', degrees).css('transform', `rotate(${degrees}deg)`);
}

// =====================================================================
// pieces <-> plain objects (what gets saved in localStorage)
// =====================================================================

function addPiece(p) {
  const $piece = $('<img class="piece" draggable="false" alt="">')
    .attr('src', p.src)
    .css({ left: p.left, top: p.top, width: p.width, zIndex: p.z ?? ++topZ })
    .appendTo($container);

  setRotate($piece, p.rotate);
  return $piece;
}

function getPieces() {
  return $container.find('.piece').map((i, piece) => ({
    src: $(piece).attr('src'),
    left: parseFloat(piece.style.left),
    top: parseFloat(piece.style.top),
    width: parseFloat(piece.style.width),
    z: Number(piece.style.zIndex),
    rotate: $(piece).data('rotate')
  })).get();
}

function showPieces(pieces) {
  $container.find('.piece').remove();
  topZ = 10;

  pieces.forEach(p => {
    topZ = Math.max(topZ, p.z);
    addPiece(p);
  });
}

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

// =====================================================================
// the current picture is saved after every change and restored when the page opens
// =====================================================================

function saveCurrent() {
  localStorage.setItem('potatoCurrent', JSON.stringify(getPieces()));
}

showPieces(load('potatoCurrent', []));

$('#clear').on('click', () => {
  showPieces([]);
  saveCurrent();
});

// =====================================================================
// named designs
// =====================================================================

const designs = load('potatoDesigns', []);
const $designsList = $('#designs');
const $designName = $('#designName');

$('#save').on('click', () => {
  const name = $designName.val().trim() || `design ${designs.length + 1}`;
  const design = { name, pieces: getPieces() };

  // saving with a name that already exists replaces that design
  const index = designs.findIndex(d => d.name === name);
  if (index === -1) {
    designs.push(design);
  } else {
    designs[index] = design;
  }

  $designName.val('');
  saveDesigns();
});

function saveDesigns() {
  localStorage.setItem('potatoDesigns', JSON.stringify(designs));
  showDesigns();
}

const $designsMenu = $('#designsMenu');

// the dropdown button opens and closes the list
$('#designsBtn').on('click', () => $designsMenu.toggleClass('open'));

// clicking anywhere outside the dropdown closes it
$(document).on('mousedown', e => {
  if (!$(e.target).closest('#designsMenu').length) {
    $designsMenu.removeClass('open');
  }
});

// one row per saved design, click the name to load it, the x deletes it
// (the rows are made fresh every time, so each button only ever gets one click handler)
function showDesigns() {
  $designsList.empty();
  $('#designsBtn').text(`saved designs (${designs.length}) ▾`);

  if (!designs.length) {
    $('<li class="empty">no saved designs yet</li>').appendTo($designsList);
  }

  designs.forEach((design, index) => {
    const $load = $('<button class="load">')
      .text(design.name)
      .on('click', () => {
        showPieces(design.pieces);
        saveCurrent();
        $designsMenu.removeClass('open');
      });

    // no text, the x is drawn by .delete::before in the css
    const $delete = $('<button class="delete">')
      .attr('title', `delete ${design.name}`)
      .on('click', () => {
        designs.splice(index, 1);
        saveDesigns();
      });

    $('<li class="design">').append($load, $delete).appendTo($designsList);
  });
}

showDesigns();

// =====================================================================
// background
// =====================================================================

const backgrounds = [
  { image: 'images/background-day.svg', color: '#7cc8f5', next: '🌙 night' },
  { image: 'images/background-night.svg', color: '#14183a', next: '☀️ day' }
];
let backgroundIndex = load('potatoBackground', 0) % backgrounds.length;

function showBackground() {
  const background = backgrounds[backgroundIndex];
  $('body').css({ backgroundImage: `url(${background.image})`, backgroundColor: background.color });
  $('#backgroundBtn').text(background.next);
}

$('#backgroundBtn').on('click', () => {
  backgroundIndex = (backgroundIndex + 1) % backgrounds.length;
  localStorage.setItem('potatoBackground', backgroundIndex);
  showBackground();
});

showBackground();

// =====================================================================
// music
// =====================================================================

const music = $('#music')[0];
const $musicBtn = $('#musicBtn');
music.volume = 0.5;

// browsers block music until the user clicks something, so start it on the first click anywhere
// (unless that click is the music button, which handles it itself)
$(document).one('mousedown', e => {
  if (!$(e.target).closest('#musicBtn').length) {
    music.play();
  }
});

$musicBtn.on('click', () => {
  if (music.paused) {
    music.play();
  } else {
    music.pause();
  }
});

$(music).on('play pause', () => {
  $musicBtn.text(music.paused ? '♪ music off' : '♪ music on').toggleClass('playing', !music.paused);
});
