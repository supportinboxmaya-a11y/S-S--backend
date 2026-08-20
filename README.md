# SUR-N-SWAG

<p align="center">
  <strong>The short video sharing platform for the social web.</strong>
  <br />
  Federated, open source, creator-friendly, and powered by <a href="https://fediverse.info">ActivityPub</a>.
</p>

<p align="center">
  <a href="https://joinloops.org">Website</a>
  ·
  <a href="https://joinloops.org/developers">API Documentation</a>
  ·
  <a href="INSTALLATION.md">Installation</a>
  ·
  <a href="https://fedidb.com/software/loops">Server List</a>
</p>

<p align="center">
  <a href="https://github.com/joinloops/loops-server/releases">
    <img src="https://img.shields.io/github/release/joinloops/loops-server.svg" alt="Latest release" />
  </a>
  <a href="https://crowdin.com/project/loops">
    <img src="https://badges.crowdin.net/loops/localized.svg" alt="Translation progress on Crowdin" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/joinloops/loops-server/actions/workflows/JS-Build-push.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/joinloops/loops-server/JS-Build-push.yml?branch=main&label=JS%20Build" alt="JavaScript build status" />
  </a>
  <a href="https://github.com/joinloops/loops-server/actions/workflows/JS-ESLint-push.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/joinloops/loops-server/JS-ESLint-push.yml?branch=main&label=ESLint" alt="ESLint status" />
  </a>
  <a href="https://github.com/joinloops/loops-server/actions/workflows/JS-Prettier-push.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/joinloops/loops-server/JS-Prettier-push.yml?branch=main&label=Prettier" alt="Prettier status" />
  </a>
  <a href="https://github.com/joinloops/loops-server/actions/workflows/JS-TypeCheck-push.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/joinloops/loops-server/JS-TypeCheck-push.yml?branch=main&label=TypeCheck" alt="TypeScript type-check status" />
  </a>
  <a href="https://github.com/joinloops/loops-server/actions/workflows/php-larastan-push.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/joinloops/loops-server/php-larastan-push.yml?branch=main&label=Larastan" alt="Larastan status" />
  </a>
  <a href="https://github.com/joinloops/loops-server/actions/workflows/php-pint.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/joinloops/loops-server/php-pint.yml?branch=main&label=Pint" alt="Laravel Pint status" />
  </a>
</p>

<p align="center">
  <img src="./screenshot.png" alt="The SUR-N-SWAG short-video platform" />
</p>

## About SUR-N-SWAG

SUR-N-SWAG is a federated, open-source platform for sharing short videos. It gives creators and communities a modern short-video experience without locking them into a centralized platform.

This repository contains the SUR-N-SWAG server and web application. Communities can operate their own SUR-N-SWAG instance while connecting with people across SUR-N-SWAG, Pixelfed, Mastodon, and other compatible ActivityPub platforms.

## Highlights

- **Federated by design** — connect and interact across the open social web using ActivityPub.
- **Self-hostable** — run an independent SUR-N-SWAG server for your community.
- **Creator-friendly** — share short videos without advertising-driven platform incentives.
- **Community-controlled** — each server can establish its own rules, policies, and moderation practices.
- **Modern discovery** — explore Following and For You feeds, hashtags, profiles, and videos.
- **Social interactions** — support for comments, replies, mentions, likes, shares, and boosts.
- **Open API** — build applications and integrations using the JSON REST API and OAuth 2.0.
- **Open source** — inspect, modify, contribute to, and redistribute the software under the AGPLv3.

## Getting Started

### Install SUR-N-SWAG

To deploy your own SUR-N-SWAG server, see the [installation guide](INSTALLATION.md).

A Docker-based setup is also available in the [Docker Compose setup guide](DOCKER_COMPOSE_SETUP.md).

### Federation

See the [federation documentation](FEDERATION.md) for information about SUR-N-SWAG and ActivityPub interoperability.

### API

The SUR-N-SWAG API is an open, publicly documented JSON REST API secured with OAuth 2.0. No partnership, application, or prior approval is required to build clients, integrations, and new experiences for the SUR-N-SWAG ecosystem.

- [Developer documentation](https://joinloops.org/developers)
- [Complete API reference](https://docs.joinloops.org)

## Contributing

Bug reports, feature requests, documentation improvements, translations, and pull requests are welcome.

Before participating, please read the [Code of Conduct](CODE_OF_CONDUCT.md).

- [Open an issue](https://github.com/joinloops/loops-server/issues)
- [View pull requests](https://github.com/joinloops/loops-server/pulls)
- [Join GitHub Discussions](https://github.com/joinloops/loops-server/discussions)

## Translations

Help make SUR-N-SWAG available to more communities and languages through [Crowdin](https://crowdin.com/project/loops).

See the [translation guide](TRANSLATING.md) for contribution instructions.

## Community

Connect with the SUR-N-SWAG community:

- **Website:** [joinloops.org](https://joinloops.org)
- **Blog:** [blog.joinloops.org](https://blog.joinloops.org)
- **Pixelfed:** [@loops@pixelfed.social](https://pixelfed.social/loops)
- **Discord:** [Join the Loops community](https://discord.gg/wvud8BgFv8)
- **Matrix:** [Join the Loops community](https://matrix.to/#/#loops:matrix.org)
- **Codeberg mirror:** [codeberg.org/loops](https://codeberg.org/loops)

## Funding

SUR-N-SWAG is funded in part through [NGI Zero Core](https://nlnet.nl/core), a fund established by [NLnet](https://nlnet.nl) with support from the European Commission's [Next Generation Internet](https://ngi.eu) program.

Learn more on the [NLnet Loops project page](https://nlnet.nl/project/Loops).

Thanks to the [Fastly Fast Forward](https://www.fastly.com/fast-forward) program, SUR-N-SWAG uses Fastly CDN and Object Storage to serve videos globally.

## License

SUR-N-SWAG Server is open-source software licensed under the [GNU Affero General Public License v3.0](LICENSE).