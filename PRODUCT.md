# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
A shopper who purchased a MacBook at Micro Center and wants to monitor product prices across stores.

## Product Purpose
Add a product link and see whether its price dropped, increased, or stayed the same since the previous successful check.

## Operating Context
Extends the existing local Node.js price tracker. User accepted a local dashboard and requested support for other stores and direct implementation in code.

## Capabilities and Constraints
Persist products and price history locally. Manual checks and hourly checks while the server is running. Micro Center product-specific extraction; other public stores with identifiable structured product offers. Store access restrictions and ambiguous prices are explicit failures, never fabricated data. Existing optional email alerts remain available.

## Product Principles
- Trustworthy prices before broad scraping coverage.
- Keep the last successful observation when a check fails.
- Make change direction and comparison time explicit.
- Adding a link is the main task; no email setup is required.
