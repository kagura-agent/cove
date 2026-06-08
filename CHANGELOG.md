# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Breaking Changes

- **`POST /api/users` — `bot` field default changed** (#264, #265):
  The `bot` field now defaults to `false` unless explicitly set to `true`.
  Previously, any non-`false` value (including `undefined`) was treated as truthy,
  meaning omitting the field would create a bot user. Now only
  `opts.bot === true` creates a bot user; all other values (including omission)
  create a human user with session TTL expiry.

  **Migration:** API consumers that relied on omitting `bot` to create bot users
  must now explicitly pass `"bot": true` in the request body.
