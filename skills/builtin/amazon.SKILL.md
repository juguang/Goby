---
name: Amazon Browsing
description: Search for products and extract product data on Amazon
domain: amazon.com
---

## amazon-search
Description: Search Amazon for products by keyword. If already on a search results page, extract product listings directly. Supports both initiating a search and scraping results.
Input: { "keyword": { "type": "string", "description": "The search keyword to look up on Amazon. If omitted and on a results page, just extract." } }
```javascript
function(params) {
  var keyword = (params && params.keyword) || '';
  var results = [];
  
  // If a keyword is provided, initiate search first
  if (keyword) {
    var searchBox = document.querySelector('#twotabsearchtextbox') ||
                    document.querySelector('input[aria-label="Search"]') ||
                    document.querySelector('input[type="text"][name="field-keywords"]');
    if (!searchBox) {
      return { content: [{ type: "text", text: "Error: Search box not found on this page." }] };
    }
    searchBox.value = keyword;
    searchBox.focus();
    var submitBtn = document.querySelector('#nav-search-submit-button');
    if (submitBtn) { submitBtn.click(); }
    else { var form = searchBox.closest('form'); if (form) form.submit(); }
    return { content: [{ type: "text", text: "Search submitted: " + keyword + ". Waiting for results page to load." }] };
  }
  
  // Extract results from the current search results page
  var cards = document.querySelectorAll('[data-component-type="s-search-result"][data-asin], .s-result-item[data-asin], [data-csa-c-item-id*="asin."]');
  var seen = {};
  for (var i = 0; i < cards.length && results.length < 8; i++) {
    var card = cards[i];
    var asin = card.getAttribute('data-asin') || '';
    if (!asin || seen[asin]) continue;
    seen[asin] = true;
    
    var titleEl = card.querySelector('h2 span, h2 a span, .a-size-medium.a-text-normal');
    var title = titleEl ? titleEl.textContent.trim() : '';
    
    var wholePrice = card.querySelector('.a-price-whole');
    var fractionPrice = card.querySelector('.a-price-fraction');
    var price = wholePrice ? ('$' + wholePrice.textContent.trim() + (fractionPrice ? '.' + fractionPrice.textContent.trim() : '')) : '';
    
    var ratingEl = card.querySelector('.a-icon-alt');
    var rating = ratingEl ? ratingEl.textContent.trim().split(' ')[0] : '';
    
    var reviewEl = card.querySelector('.a-size-base.s-underline-text');
    var reviews = reviewEl ? reviewEl.textContent.trim() : '';
    
    var linkEl = card.querySelector('a.a-link-normal[href*="/dp/"], h2 a');
    var link = linkEl ? linkEl.href : '';
    
    results.push({ title: title, price: price, rating: rating, reviews: reviews, url: link });
  }
  
  if (results.length === 0) {
    return { content: [{ type: "text", text: "No product results found on the current page. Try providing a keyword to search." }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
}
```

## amazon-product
Description: Extract detailed product info (title, price, rating, availability, features) from the current Amazon product page. Only use on individual product pages, not search results.
Input: {}
```javascript
function() {
  // Check if on a product page
  if (!window.location.href.match(/\/dp\/|\/gp\/product\//)) {
    return { content: [{ type: "text", text: "Not on a product page. Use amazon-search first to find products." }] };
  }
  
  var title = '', price = '', rating = '', availability = '', features = [];
  
  var titleEl = document.querySelector('#productTitle');
  if (titleEl) title = titleEl.textContent.trim();
  
  var priceEl = document.querySelector('.a-price .a-offscreen') ||
                document.querySelector('#priceblock_ourprice') ||
                document.querySelector('.a-price-whole');
  if (priceEl) price = priceEl.textContent.trim();
  
  var ratingEl = document.querySelector('#acrPopover .a-icon-alt') ||
                 document.querySelector('[data-hook="rating-out-of-text"]');
  if (ratingEl) rating = ratingEl.textContent.trim();
  
  var availEl = document.querySelector('#availability span') ||
                document.querySelector('[data-csa-c-delivery-price]');
  if (availEl) availability = availEl.textContent.trim();
  
  var featureEls = document.querySelectorAll('#feature-bullets li:not(.aok-hidden) span.a-list-item');
  for (var i = 0; i < featureEls.length && i < 5; i++) {
    features.push(featureEls[i].textContent.trim());
  }
  
  return { content: [{ type: "text", text: JSON.stringify({ title: title, price: price, rating: rating, availability: availability, features: features }, null, 2) }] };
}
```
