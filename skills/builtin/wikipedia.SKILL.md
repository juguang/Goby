---
name: Wikipedia Browsing
description: Search Wikipedia and extract article content including title, summary, and section headings
domain: wikipedia.org
---

## wikipedia-search
Description: Search Wikipedia using the site's search box. Navigates to search results or directly to the article if found.
Input: { "query": { "type": "string", "description": "The search term to look up on Wikipedia" } }
```javascript
function(params) {
  var query = params.query;
  if (!query) {
    return { content: [{ type: "text", text: "Please provide a search query." }] };
  }
  var searchBox = document.querySelector('#searchInput');
  if (!searchBox) {
    searchBox = document.querySelector('input[name="search"]');
  }
  if (!searchBox) {
    searchBox = document.querySelector('input[aria-label="Search Wikipedia"]');
  }
  if (!searchBox) {
    searchBox = document.querySelector('.cdx-text-input__input');
  }
  if (!searchBox) {
    return { content: [{ type: "text", text: "Could not find Wikipedia search box on this page." }] };
  }
  searchBox.value = query;
  searchBox.focus();
  var form = searchBox.closest('form');
  if (form) {
    form.submit();
    return { content: [{ type: "text", text: "Searching Wikipedia for: " + query }] };
  }
  searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  return { content: [{ type: "text", text: "Triggered Wikipedia search for: " + query }] };
}
```

## wikipedia-page
Description: Extract the article title, first few summary paragraphs, and table of contents section headings from the current Wikipedia page.
Input: {}
```javascript
function(params) {
  var title = '';
  var summary = '';
  var sections = [];
  var titleEl = document.querySelector('#firstHeading');
  if (!titleEl) {
    titleEl = document.querySelector('.mw-page-title-main');
  }
  if (titleEl) {
    title = titleEl.textContent.trim();
  }
  var contentEl = document.querySelector('#mw-content-text');
  if (!contentEl) {
    contentEl = document.querySelector('.mw-parser-output');
  }
  if (contentEl) {
    var paragraphs = contentEl.querySelectorAll(':scope > p, :scope > .mw-parser-output > p');
    if (paragraphs.length === 0) {
      paragraphs = contentEl.querySelectorAll('p');
    }
    for (var i = 0; i < paragraphs.length; i++) {
      var text = paragraphs[i].textContent.trim();
      if (text.length > 30) {
        summary += (summary ? '\n\n' : '') + text;
      }
      if (summary.length > 2000) {
        break;
      }
    }
    var headingEls = contentEl.querySelectorAll(':scope > h2, :scope > .mw-heading2');
    for (var j = 0; j < headingEls.length; j++) {
      var headingText = headingEls[j].textContent.trim();
      headingText = headingText.replace(/\[edit\]$/, '').trim();
      if (headingText && headingText !== 'Contents' && headingText !== 'References' && headingText !== 'External links' && headingText !== 'See also' && headingText !== 'Notes') {
        sections.push(headingText);
      }
      if (sections.length >= 20) {
        break;
      }
    }
  }
  var result = JSON.stringify({
    title: title,
    summary: summary.substring(0, 2500),
    sections: sections
  });
  return { content: [{ type: "text", text: result }] };
}
```
