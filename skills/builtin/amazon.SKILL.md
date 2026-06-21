---
name: Amazon Browsing
description: Search for products and extract product data on Amazon
domain: amazon.com
---

## amazon-search
Description: Search Amazon for products by keyword and navigate to search results page.
Input: { "keyword": { "type": "string", "description": "The search keyword to look up on Amazon" } }
```javascript
function(params) {
  var keyword = params.keyword;
  if (!keyword) {
    return { content: [{ type: "text", text: "Please provide a keyword to search for." }] };
  }
  var searchBox = document.querySelector('#twotabsearchtextbox');
  if (!searchBox) {
    searchBox = document.querySelector('input[aria-label="Search"]');
  }
  if (!searchBox) {
    searchBox = document.querySelector('input[type="text"][name="field-keywords"]');
  }
  if (!searchBox) {
    return { content: [{ type: "text", text: "Could not find Amazon search box on this page." }] };
  }
  searchBox.value = keyword;
  searchBox.focus();
  var navInput = document.querySelector('#nav-search-submit-button');
  if (navInput) {
    navInput.click();
  } else {
    var form = searchBox.closest('form');
    if (form) {
      form.submit();
    }
  }
  return { content: [{ type: "text", text: "Searching Amazon for: " + keyword }] };
}
```

## amazon-product
Description: Extract product title, price, rating, and availability from the current Amazon product page.
Input: {}
```javascript
function(params) {
  var title = '';
  var price = '';
  var rating = '';
  var availability = '';
  var titleEl = document.querySelector('#productTitle');
  if (titleEl) {
    title = titleEl.textContent.trim();
  }
  var priceEl = document.querySelector('.a-price .a-offscreen');
  if (!priceEl || !priceEl.textContent.trim()) {
    priceEl = document.querySelector('#priceblock_ourprice');
  }
  if (!priceEl || !priceEl.textContent.trim()) {
    priceEl = document.querySelector('.a-price-whole');
  }
  if (priceEl) {
    price = priceEl.textContent.trim();
  }
  var ratingEl = document.querySelector('#acrPopover .a-icon-alt');
  if (!ratingEl) {
    ratingEl = document.querySelector('[data-hook="rating-out-of-text"]');
  }
  if (ratingEl) {
    rating = ratingEl.textContent.trim();
  }
  var availEl = document.querySelector('#availability span');
  if (!availEl) {
    availEl = document.querySelector('[data-csa-c-delivery-price]');
  }
  if (availEl) {
    availability = availEl.textContent.trim();
  }
  var result = JSON.stringify({
    title: title,
    price: price,
    rating: rating,
    availability: availability
  });
  return { content: [{ type: "text", text: result }] };
}
```
