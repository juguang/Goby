---
name: GitHub Browsing
description: Browse repositories, search code, and extract repo information on GitHub
domain: github.com
---

## github-repo-info
Description: Extract repository name, description, stars, forks, and primary language from the current GitHub repository page.
Input: {}
```javascript
function(params) {
  var name = '';
  var description = '';
  var stars = '';
  var forks = '';
  var language = '';
  var nameEl = document.querySelector('[itemprop="name"]');
  if (!nameEl) {
    nameEl = document.querySelector('strong[itemprop="name"] a');
  }
  if (nameEl) {
    name = nameEl.textContent.trim();
  }
  var descEl = document.querySelector('[itemprop="description"]');
  if (!descEl) {
    descEl = document.querySelector('.f4.my-3');
  }
  if (descEl) {
    description = descEl.textContent.trim();
  }
  var starsEl = document.querySelector('#repo-stars-counter-star');
  if (!starsEl) {
    starsEl = document.querySelector('a[href$="/stargazers"] .Counter');
  }
  if (!starsEl) {
    starsEl = document.querySelector('a[href$="/stargazers"] strong');
  }
  if (starsEl) {
    stars = starsEl.textContent.trim();
  }
  var forksEl = document.querySelector('#repo-network-counter');
  if (!forksEl) {
    forksEl = document.querySelector('a[href$="/forks"] .Counter');
  }
  if (!forksEl) {
    forksEl = document.querySelector('a[href$="/forks"] strong');
  }
  if (forksEl) {
    forks = forksEl.textContent.trim();
  }
  var langEl = document.querySelector('[itemprop="programmingLanguage"]');
  if (!langEl) {
    var progressItems = document.querySelectorAll('.Progress + div .d-inline-flex');
    for (var i = 0; i < progressItems.length; i++) {
      var text = progressItems[i].textContent.trim();
      if (text && text.indexOf('%') === -1) {
        language = text;
        break;
      }
    }
  }
  if (langEl) {
    language = langEl.textContent.trim();
  }
  var result = JSON.stringify({
    name: name,
    description: description,
    stars: stars,
    forks: forks,
    language: language
  });
  return { content: [{ type: "text", text: result }] };
}
```

## github-search
Description: Search GitHub using the site's search bar. Types the query and submits the search form.
Input: { "query": { "type": "string", "description": "The search query to run on GitHub" } }
```javascript
function(params) {
  var query = params.query;
  if (!query) {
    return { content: [{ type: "text", text: "Please provide a search query." }] };
  }
  var searchInput = document.querySelector('input[data-target="query-builder.input"]');
  if (!searchInput) {
    searchInput = document.querySelector('#query-builder-test');
  }
  if (!searchInput) {
    searchInput = document.querySelector('input[name="q"]');
  }
  if (!searchInput) {
    searchInput = document.querySelector('header input[type="text"]');
  }
  if (!searchInput) {
    return { content: [{ type: "text", text: "Could not find GitHub search box on this page." }] };
  }
  searchInput.value = query;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  var form = searchInput.closest('form');
  if (form) {
    form.submit();
    return { content: [{ type: "text", text: "Searching GitHub for: " + query }] };
  }
  searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  return { content: [{ type: "text", text: "Triggered GitHub search for: " + query }] };
}
```
