---
name: Baidu Search Browsing
description: Extract search result titles, URLs, and snippets from a Baidu search results page
domain: baidu.com
---

## baidu-search-results
Description: Extract the titles, URLs, and text snippets of the first 10 Baidu search results on the current page.
Input: {}
```javascript
function(params) {
  var results = [];
  var containers = document.querySelectorAll('.result');
  if (containers.length === 0) {
    containers = document.querySelectorAll('.c-container');
  }
  if (containers.length === 0) {
    containers = document.querySelectorAll('#content_left > div');
  }
  for (var i = 0; i < containers.length; i++) {
    var el = containers[i];
    if (results.length >= 10) {
      break;
    }
    var titleEl = el.querySelector('h3 a');
    if (!titleEl) {
      titleEl = el.querySelector('.t a');
    }
    if (!titleEl) {
      titleEl = el.querySelector('a[href*="baidu.com/link"]');
    }
    var snippetEl = el.querySelector('.c-abstract');
    if (!snippetEl) {
      snippetEl = el.querySelector('.c-span-last');
    }
    if (!snippetEl) {
      snippetEl = el.querySelector('[class*="content"]');
    }
    if (titleEl) {
      results.push({
        title: titleEl.textContent.trim(),
        url: titleEl.href || '',
        snippet: snippetEl ? snippetEl.textContent.trim() : ''
      });
    }
  }
  var output = results.length > 0
    ? JSON.stringify(results)
    : JSON.stringify({ message: 'No Baidu search results found. Are you on a Baidu search results page (www.baidu.com/s)?' });
  return { content: [{ type: "text", text: output }] };
}
```
