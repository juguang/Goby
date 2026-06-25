---
name: Amazon
description: Search products, extract listings and product details on Amazon. Auto-detects page type — use for any Amazon task.
domain: amazon.com
---

## amazon
Description: The ONLY tool for Amazon. Searches products by keyword, extracts search result listings, or gets product details — auto-detects what to do based on the current page. Call without keyword on results page to scrape listings. Call without keyword on product page (/dp/) to get details.
Input: { "keyword": { "type": "string", "description": "Optional. Search keyword to look up. Omit on results/product pages to scrape current page." } }
```javascript
function(params) {
  var keyword = (params && params.keyword) || '';
  var href = window.location.href;

  // MODE 1: Keyword provided → fill search & submit
  if (keyword) {
    var searchBox = document.querySelector('#twotabsearchtextbox') ||
                    document.querySelector('input[aria-label="Search"]') ||
                    document.querySelector('input[type="text"][name="field-keywords"]');
    if (!searchBox) {
      return { content: [{ type: "text", text: "Search box not found. Are you on amazon.com?" }] };
    }
    searchBox.value = keyword;
    var submitBtn = document.querySelector('#nav-search-submit-button');
    if (submitBtn) { submitBtn.click(); }
    else { var f = searchBox.closest('form'); if (f) f.submit(); }
    return { content: [{ type: "text", text: "Submitted search: " + keyword }] };
  }

  // MODE 2: Product page → extract details
  if (href.indexOf('/dp/') !== -1 || href.indexOf('/gp/product/') !== -1) {
    var p = {};
    var te = document.querySelector('#productTitle');
    if (te) p.title = te.textContent.trim();
    var pe = document.querySelector('.a-price .a-offscreen') || document.querySelector('#priceblock_ourprice') || document.querySelector('.a-price-whole');
    if (pe) p.price = pe.textContent.trim();
    var re = document.querySelector('#acrPopover .a-icon-alt') || document.querySelector('[data-hook="rating-out-of-text"]');
    if (re) p.rating = re.textContent.trim().split(' ')[0];
    var ae = document.querySelector('#availability span');
    if (ae) p.availability = ae.textContent.trim();
    return { content: [{ type: "text", text: JSON.stringify(p) }] };
  }

  // MODE 3: Search results → scrape listings
  var results = [];
  var cards = document.querySelectorAll('[data-component-type="s-search-result"][data-asin], .s-result-item[data-asin]');
  for (var i = 0; i < cards.length && results.length < 8; i++) {
    var c = cards[i];
    var asin = c.getAttribute('data-asin') || '';
    if (!asin) continue;
    var t = c.querySelector('h2 span, h2 a, .a-size-medium.a-text-normal');
    var title = t ? t.textContent.trim().replace(/\s+/g, ' ') : '';
    if (!title) continue;
    var wp = c.querySelector('.a-price-whole');
    var fp = c.querySelector('.a-price-fraction');
    var price = wp ? ('$' + wp.textContent.trim() + (fp ? '.' + fp.textContent.trim() : '')) : '';
    var r = c.querySelector('.a-icon-alt');
    var rating = r ? r.textContent.trim().split(' ')[0] : '';
    var a = c.querySelector('a.a-link-normal[href*="/dp/"], h2 a');
    var url = a ? a.href : '';
    results.push({ title: title, price: price, rating: rating, url: url });
  }
  if (results.length === 0) {
    return { content: [{ type: "text", text: "No results found on this page. Try a keyword search." }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(results) }] };
}
```
