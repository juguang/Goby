---
name: Google Search Browsing
description: Extract search result titles, URLs, and snippets from a Google search results page
domain: google.com
---

## google-search-results
Description: Extract the titles, URLs, and text snippets of the first 10 Google search results on the current page.
Input: {}
```javascript
function(params) {
  var results = [];
  var resultEls = document.querySelectorAll('.g');
  if (resultEls.length === 0) {
    resultEls = document.querySelectorAll('[data-sokoban-container]');
  }
  if (resultEls.length === 0) {
    resultEls = document.querySelectorAll('#search .g');
  }
  if (resultEls.length === 0) {
    resultEls = document.querySelectorAll('#rso > div');
  }
  for (var i = 0; i < resultEls.length; i++) {
    var el = resultEls[i];
    if (results.length >= 10) {
      break;
    }
    var titleEl = el.querySelector('h3');
    var linkEl = el.querySelector('a[href^="http"]');
    if (!linkEl) {
      linkEl = el.querySelector('a');
    }
    var snippetEl = el.querySelector('.VwiC3b');
    if (!snippetEl) {
      snippetEl = el.querySelector('[data-sncf]');
    }
    if (!snippetEl) {
      snippetEl = el.querySelector('span.st');
    }
    var title = titleEl ? titleEl.textContent.trim() : '';
    var url = linkEl ? linkEl.href : '';
    if (!title && !url) {
      continue;
    }
    results.push({
      title: title,
      url: url,
      snippet: snippetEl ? snippetEl.textContent.trim() : ''
    });
  }
  var output = results.length > 0
    ? JSON.stringify(results)
    : JSON.stringify({ message: 'No Google search results found. Are you on a Google search results page (google.com/search)?' });
  return { content: [{ type: "text", text: output }] };
}
```
