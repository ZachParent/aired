(function () {
  var root = document.getElementById("__aired-bar");
  if (!root) return;

  var button = document.getElementById("__aired-comment-button");
  var countEl = document.getElementById("__aired-comment-count");
  var pageId = root.getAttribute("data-aired-page-id");
  if (!button || !pageId) return;

  var apiBase = "/api/pages/" + encodeURIComponent(pageId) + "/comments";
  var state = {
    mode: "idle",
    initialized: false,
    identity: null,
    comments: [],
    hoverTarget: null,
    selectedTarget: null,
    highlight: null,
    pinsLayer: null,
    popover: null,
    raf: 0,
    repositionRaf: 0,
    observer: null,
  };

  function injectStyle() {
    if (document.getElementById("__aired-comment-style")) return;
    var style = document.createElement("style");
    style.id = "__aired-comment-style";
    style.textContent =
      "#__aired-comment-highlight{position:fixed;left:0;top:0;width:0;height:0;transform:translate3d(0,0,0);opacity:0;pointer-events:none;z-index:2147483645;background:rgba(124,106,239,.14);border:1px solid rgba(124,106,239,.62);border-radius:10px;box-shadow:0 0 0 1px rgba(255,255,255,.16) inset,0 8px 28px rgba(82,64,210,.18);transition:transform 150ms cubic-bezier(.2,.8,.2,1),width 150ms cubic-bezier(.2,.8,.2,1),height 150ms cubic-bezier(.2,.8,.2,1),opacity 120ms ease,border-radius 150ms ease;will-change:transform,width,height,opacity;}" +
      "#__aired-comment-highlight.is-visible{opacity:1;}" +
      "#__aired-comment-pins{position:fixed;inset:0;z-index:2147483646;pointer-events:none;font-family:Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;}" +
      ".__aired-comment-pin{position:fixed;width:18px;height:18px;border:1px solid rgba(255,255,255,.38);border-radius:999px;background:rgba(124,106,239,.9);color:#fff;box-shadow:0 3px 12px rgba(0,0,0,.26),0 0 0 3px rgba(124,106,239,.15);display:flex;align-items:center;justify-content:center;padding:0;margin:0;pointer-events:auto;cursor:pointer;font:700 10px/1 Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;transition:transform 140ms ease,box-shadow 140ms ease,background 140ms ease;}" +
      ".__aired-comment-pin:hover,.__aired-comment-pin:focus-visible{transform:translate3d(var(--aired-x),var(--aired-y),0) scale(1.08);box-shadow:0 5px 18px rgba(0,0,0,.3),0 0 0 4px rgba(124,106,239,.18);outline:none;}" +
      ".__aired-comment-pin img{width:100%;height:100%;border-radius:inherit;display:block;}" +
      ".__aired-comment-preview{position:absolute;right:22px;top:-7px;width:min(260px,calc(100vw - 44px));padding:8px 9px;border-radius:8px;background:rgba(15,15,18,.94);border:1px solid rgba(255,255,255,.1);box-shadow:0 10px 30px rgba(0,0,0,.28);color:rgba(245,245,247,.94);opacity:0;transform:translateY(3px);transition:opacity 120ms ease,transform 120ms ease;pointer-events:none;text-align:left;}" +
      ".__aired-comment-pin:hover .__aired-comment-preview,.__aired-comment-pin:focus-visible .__aired-comment-preview{opacity:1;transform:translateY(0);}" +
      ".__aired-comment-preview strong{display:block;margin:0 0 4px;color:#fff;font-size:11px;font-weight:650;}" +
      ".__aired-comment-preview span{display:block;font-size:12px;line-height:1.35;color:rgba(245,245,247,.82);white-space:normal;}" +
      "#__aired-comment-popover{position:fixed;z-index:2147483647;width:min(300px,calc(100vw - 24px));padding:10px;border-radius:10px;background:rgba(15,15,18,.96);border:1px solid rgba(255,255,255,.12);box-shadow:0 14px 40px rgba(0,0,0,.32);color:rgba(245,245,247,.9);font-family:Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;}" +
      "#__aired-comment-popover .__aired-comment-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}" +
      "#__aired-comment-popover .__aired-comment-avatar{width:22px;height:22px;border-radius:999px;background:rgba(124,106,239,.22);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;overflow:hidden;flex:0 0 auto;}" +
      "#__aired-comment-popover .__aired-comment-avatar img{width:100%;height:100%;display:block;object-fit:cover;}" +
      "#__aired-comment-popover .__aired-comment-name{font-size:12px;font-weight:650;color:#fff;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      "#__aired-comment-popover textarea{width:100%;min-height:78px;resize:vertical;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:rgba(255,255,255,.06);color:#fff;padding:8px;font:12px/1.4 Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;outline:none;box-sizing:border-box;}" +
      "#__aired-comment-popover textarea:focus{border-color:rgba(124,106,239,.72);box-shadow:0 0 0 3px rgba(124,106,239,.12);}" +
      "#__aired-comment-popover .__aired-comment-body{font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word;margin:0;color:rgba(245,245,247,.86);}" +
      "#__aired-comment-popover .__aired-comment-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:9px;}" +
      "#__aired-comment-popover .__aired-comment-github{margin-right:auto;color:rgba(199,190,255,.95);text-decoration:none;font-size:11px;font-weight:600;}" +
      "#__aired-comment-popover button{appearance:none;border:0;border-radius:7px;padding:6px 9px;font:650 11px/1 Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif;cursor:pointer;}" +
      "#__aired-comment-popover .__aired-comment-secondary{background:rgba(255,255,255,.08);color:rgba(245,245,247,.85);}" +
      "#__aired-comment-popover .__aired-comment-primary{background:#7c6aef;color:#fff;}" +
      "#__aired-comment-popover .__aired-comment-error{display:none;margin-top:7px;color:#ffb4b4;font-size:11px;line-height:1.35;}" +
      "#__aired-comment-popover.has-error .__aired-comment-error{display:block;}" +
      "@media (prefers-reduced-motion:reduce){#__aired-comment-highlight,.__aired-comment-pin,.__aired-comment-preview{transition:none;}}";
    document.head.appendChild(style);
  }

  function initShell() {
    if (state.initialized) return;
    state.initialized = true;
    injectStyle();

    state.highlight = document.createElement("div");
    state.highlight.id = "__aired-comment-highlight";
    document.body.appendChild(state.highlight);

    state.pinsLayer = document.createElement("div");
    state.pinsLayer.id = "__aired-comment-pins";
    document.body.appendChild(state.pinsLayer);

    document.addEventListener("mousemove", onDocumentMouseMove, true);
    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("scroll", scheduleReposition, true);
    window.addEventListener("resize", scheduleReposition);

    state.observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        if (!isOwnElement(mutations[i].target)) {
          scheduleReposition();
          return;
        }
      }
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });

    loadComments();
  }

  function setPressed(pressed) {
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
    root.classList.toggle("is-open", pressed);
  }

  function startPicking() {
    initShell();
    closePopover();
    state.mode = "picking";
    state.hoverTarget = null;
    state.selectedTarget = null;
    setPressed(true);
    loadSession();
  }

  function closeAll() {
    state.mode = "idle";
    state.hoverTarget = null;
    state.selectedTarget = null;
    hideHighlight();
    closePopover();
    setPressed(false);
  }

  button.addEventListener("click", function (event) {
    event.preventDefault();
    if (state.mode === "idle") {
      startPicking();
      return;
    }
    closeAll();
  });

  function isOwnElement(node) {
    if (!node || node.nodeType !== 1) return false;
    return Boolean(
      node.closest("#__aired-bar,#__aired-comment-popover,#__aired-comment-pins,#__aired-comment-highlight"),
    );
  }

  function onDocumentMouseMove(event) {
    if (state.mode !== "picking") return;
    var target = event.target;
    if (!target || isOwnElement(target)) return;
    if (target === document.documentElement || target === document.body) return;
    state.hoverTarget = target;
    scheduleHighlight(target);
  }

  function onDocumentClick(event) {
    if (state.mode !== "picking") return;
    var target = event.target;
    if (!target || isOwnElement(target)) return;
    if (target === document.documentElement || target === document.body) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openComposer(target);
  }

  function scheduleHighlight(target) {
    if (state.raf) return;
    state.raf = window.requestAnimationFrame(function () {
      state.raf = 0;
      setHighlight(target);
    });
  }

  function setHighlight(target) {
    if (!state.highlight || !target || !target.getBoundingClientRect) return;
    var rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hideHighlight();
      return;
    }
    var width = Math.max(10, rect.width);
    var height = Math.max(10, rect.height);
    var x = Math.max(0, rect.left);
    var y = Math.max(0, rect.top);
    state.highlight.style.width = width + "px";
    state.highlight.style.height = height + "px";
    state.highlight.style.transform = "translate3d(" + x + "px," + y + "px,0)";
    state.highlight.style.borderRadius = width < 30 || height < 30 ? "6px" : "10px";
    state.highlight.classList.add("is-visible");
  }

  function hideHighlight() {
    if (state.highlight) state.highlight.classList.remove("is-visible");
  }

  function positionPopoverNear(target) {
    if (!state.popover || !target || !target.getBoundingClientRect) return;
    var rect = target.getBoundingClientRect();
    var popoverRect = state.popover.getBoundingClientRect();
    var width = popoverRect.width || 300;
    var height = popoverRect.height || 160;
    var left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    var top = rect.bottom + 10;
    if (top + height > window.innerHeight - 12) {
      top = Math.max(12, rect.top - height - 10);
    }
    state.popover.style.left = left + "px";
    state.popover.style.top = top + "px";
  }

  function openComposer(target) {
    state.mode = "composing";
    state.selectedTarget = target;
    setPressed(true);
    setHighlight(target);
    closePopover();

    var popover = document.createElement("div");
    popover.id = "__aired-comment-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Leave a comment");
    popover.innerHTML =
      '<div class="__aired-comment-head">' +
      renderAvatar(state.identity) +
      '<div class="__aired-comment-name">' +
      escapeHtml(authorName(state.identity)) +
      "</div>" +
      "</div>" +
      '<textarea maxlength="2000" placeholder="Leave a comment"></textarea>' +
      '<div class="__aired-comment-error">Could not save this comment. Try again.</div>' +
      '<div class="__aired-comment-actions">' +
      githubLinkHtml() +
      '<button type="button" class="__aired-comment-secondary" data-aired-cancel>Cancel</button>' +
      '<button type="button" class="__aired-comment-primary" data-aired-post>Post</button>' +
      "</div>";
    document.body.appendChild(popover);
    state.popover = popover;
    positionPopoverNear(target);

    var textarea = popover.querySelector("textarea");
    var cancel = popover.querySelector("[data-aired-cancel]");
    var post = popover.querySelector("[data-aired-post]");
    if (textarea) textarea.focus();
    if (cancel) cancel.addEventListener("click", closeAll);
    if (post) {
      post.addEventListener("click", function () {
        submitComment(textarea, post, target);
      });
    }
  }

  function closePopover() {
    if (state.popover && state.popover.parentNode) {
      state.popover.parentNode.removeChild(state.popover);
    }
    state.popover = null;
  }

  function showReadPopover(comment, target) {
    closePopover();
    state.mode = "reading";
    state.selectedTarget = target;
    setPressed(true);
    if (target) setHighlight(target);

    var popover = document.createElement("div");
    popover.id = "__aired-comment-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Comment");
    popover.innerHTML =
      '<div class="__aired-comment-head">' +
      renderAvatar(comment.author) +
      '<div class="__aired-comment-name">' +
      escapeHtml(authorName(comment.author)) +
      "</div>" +
      "</div>" +
      '<p class="__aired-comment-body">' +
      escapeHtml(comment.body) +
      "</p>" +
      '<div class="__aired-comment-actions">' +
      '<button type="button" class="__aired-comment-secondary" data-aired-close>Close</button>' +
      "</div>";
    document.body.appendChild(popover);
    state.popover = popover;
    positionPopoverNear(target || document.body);
    var close = popover.querySelector("[data-aired-close]");
    if (close) close.addEventListener("click", closeAll);
  }

  async function submitComment(textarea, buttonEl, target) {
    if (!textarea) return;
    var body = textarea.value.trim();
    if (!body) {
      textarea.focus();
      return;
    }
    var anchor = buildAnchor(target);
    if (!anchor) return;
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = "Posting";
    }
    if (state.popover) state.popover.classList.remove("has-error");
    try {
      var response = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ body: body, anchor: anchor }),
      });
      if (!response.ok) throw new Error("Comment save failed");
      var json = await response.json();
      if (json.identity) state.identity = json.identity;
      if (json.comment) state.comments.push(json.comment);
      renderPins();
      updateCount();
      closeAll();
    } catch (error) {
      if (state.popover) state.popover.classList.add("has-error");
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent = "Post";
      }
    }
  }

  async function loadSession() {
    try {
      var response = await fetch(apiBase + "/session", { credentials: "same-origin" });
      if (!response.ok) return;
      var json = await response.json();
      state.identity = json.identity || state.identity;
      if (state.popover && state.mode === "composing") {
        var name = state.popover.querySelector(".__aired-comment-name");
        if (name) name.textContent = authorName(state.identity);
      }
    } catch (error) {
      return;
    }
  }

  async function loadComments() {
    try {
      var response = await fetch(apiBase, { credentials: "same-origin" });
      if (!response.ok) return;
      var json = await response.json();
      state.comments = Array.isArray(json.comments) ? json.comments : [];
      renderPins();
      updateCount();
    } catch (error) {
      return;
    }
  }

  function updateCount() {
    if (!countEl) return;
    var count = state.comments.length;
    if (count === 0) {
      countEl.hidden = true;
      countEl.textContent = "";
      return;
    }
    countEl.hidden = false;
    countEl.textContent = count > 99 ? "99+" : String(count);
  }

  function renderPins() {
    if (!state.pinsLayer) return;
    state.pinsLayer.textContent = "";
    state.comments.forEach(function (comment) {
      var target = resolveAnchor(comment.anchor);
      if (!target) return;
      var rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      var pin = document.createElement("button");
      pin.type = "button";
      pin.className = "__aired-comment-pin";
      pin.setAttribute("aria-label", "Comment from " + authorName(comment.author));
      var x = Math.min(window.innerWidth - 24, Math.max(6, rect.right - 9));
      var y = Math.min(window.innerHeight - 24, Math.max(6, rect.top - 9));
      pin.style.setProperty("--aired-x", x + "px");
      pin.style.setProperty("--aired-y", y + "px");
      pin.style.transform = "translate3d(" + x + "px," + y + "px,0)";
      pin.innerHTML =
        renderPinIcon(comment.author) +
        '<span class="__aired-comment-preview"><strong>' +
        escapeHtml(authorName(comment.author)) +
        "</strong><span>" +
        escapeHtml(comment.body.length > 160 ? comment.body.slice(0, 157) + "..." : comment.body) +
        "</span></span>";
      pin.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        showReadPopover(comment, target);
      });
      state.pinsLayer.appendChild(pin);
    });
  }

  function scheduleReposition() {
    if (!state.initialized || state.repositionRaf) return;
    state.repositionRaf = window.requestAnimationFrame(function () {
      state.repositionRaf = 0;
      if (state.mode === "picking" && state.hoverTarget) {
        setHighlight(state.hoverTarget);
      }
      if ((state.mode === "composing" || state.mode === "reading") && state.selectedTarget) {
        setHighlight(state.selectedTarget);
        positionPopoverNear(state.selectedTarget);
      }
      renderPins();
    });
  }

  function buildAnchor(target) {
    if (!target || !target.getBoundingClientRect) return null;
    var rect = target.getBoundingClientRect();
    var text = textQuote(target);
    return {
      selector: buildSelector(target),
      selectorVersion: 1,
      textQuote: text,
      elementPath: elementPath(target),
      elementHash: text ? simpleHash(text) : null,
      rect: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
  }

  function resolveAnchor(anchor) {
    if (!anchor || typeof anchor.selector !== "string") return null;
    try {
      var target = document.querySelector(anchor.selector);
      if (target && !isOwnElement(target)) return target;
    } catch (error) {
      return null;
    }
    return null;
  }

  function buildSelector(element) {
    if (element.id) {
      var idSelector = "#" + cssEscape(element.id);
      if (isUnique(idSelector, element)) return idSelector;
    }
    var attrs = ["data-aired-comment-id", "data-testid", "data-test", "data-cy", "aria-label"];
    for (var i = 0; i < attrs.length; i += 1) {
      var value = element.getAttribute(attrs[i]);
      if (value) {
        var attrSelector =
          element.tagName.toLowerCase() + "[" + attrs[i] + '="' + cssEscapeAttribute(value) + '"]';
        if (isUnique(attrSelector, element)) return attrSelector;
      }
    }
    var path = [];
    var node = element;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var tag = node.tagName.toLowerCase();
      var index = nthOfType(node);
      path.unshift(tag + ":nth-of-type(" + index + ")");
      node = node.parentElement;
    }
    return path.length ? path.join(" > ") : element.tagName.toLowerCase();
  }

  function isUnique(selector, element) {
    try {
      var match = document.querySelectorAll(selector);
      return match.length === 1 && match[0] === element;
    } catch (error) {
      return false;
    }
  }

  function nthOfType(element) {
    var index = 1;
    var sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === element.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function elementPath(element) {
    var parts = [];
    var node = element;
    while (node && node.nodeType === 1 && parts.length < 24) {
      parts.unshift(node.tagName.toLowerCase());
      node = node.parentElement;
    }
    return parts;
  }

  function textQuote(element) {
    var text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 240) : null;
  }

  function simpleHash(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  function authorName(author) {
    return author && author.displayName ? author.displayName : "Anonymous";
  }

  function renderAvatar(author) {
    var name = authorName(author);
    if (author && author.avatarUrl) {
      return (
        '<span class="__aired-comment-avatar"><img src="' +
        escapeHtml(author.avatarUrl) +
        '" alt=""></span>'
      );
    }
    return '<span class="__aired-comment-avatar">' + escapeHtml(iconGlyph(author, name)) + "</span>";
  }

  function renderPinIcon(author) {
    if (author && author.avatarUrl) {
      return '<img src="' + escapeHtml(author.avatarUrl) + '" alt="">';
    }
    return escapeHtml(iconGlyph(author, authorName(author)));
  }

  function iconGlyph(author, name) {
    var icon = author && author.icon ? author.icon : "";
    var icons = {
      spark: "*",
      dot: ".",
      wave: "~",
      ring: "o",
      beam: "|",
      prism: "^",
      orbit: "@",
      flare: "+",
    };
    if (icons[icon]) return icons[icon];
    return name ? name.slice(0, 1).toUpperCase() : "?";
  }

  function githubLinkHtml() {
    if (state.identity && state.identity.type === "github") return "";
    var href = "/auth/github?return=" + encodeURIComponent("/p/" + pageId);
    return '<a class="__aired-comment-github" href="' + href + '">Use GitHub</a>';
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, function (match, digit) {
      return digit ? "\\3" + digit + " " : "\\" + match;
    });
  }

  function cssEscapeAttribute(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  initShell();
})();
