# AcademiaPro Connect

AcademiaPro Connect is a public WordPress/WooCommerce plugin project that connects a school website with an external academy management system.

The goal is simple: when a student buys a course or class pack through WooCommerce, the plugin should send the relevant customer and course data to an external API so the enrollment process can start without manual admin work.

## Why this project exists

This repository exists for two practical reasons:

1. To build real, hands-on experience with WordPress and WooCommerce through a non-trivial project.
2. To develop a public, reviewable codebase that complements other private production projects.

It is inspired by a real operational need in small academies, but it is being built as a standalone open-source plugin with no private business logic, credentials, or sensitive data.

## Phase 1 scope

Week 1 focuses on a realistic first version:

- A standalone WordPress plugin installable in a local WordPress setup
- A basic admin settings page for API credentials and academy identification
- A WooCommerce order-completed hook
- Product-to-course mapping through product metadata
- An HTTP request to a mock API endpoint with student and course data
- Basic success/error logging visible from WordPress admin

This phase does not include production deployment, connection to the private AcademiaPro codebase, or advanced automation features.

## Status

This repository is currently in early setup and implementation phase.

