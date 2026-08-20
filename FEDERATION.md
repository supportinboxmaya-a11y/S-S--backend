# Federation Documentation

This document outlines the ActivityPub federation implementation in SUR-N-SWAG, including supported activities, actors, and discovery mechanisms.

## Overview

SUR-N-SWAG implements the ActivityPub protocol to enable federation with other ActivityPub-compatible platforms. This allows users to follow, interact with, and share content across the fediverse.

## Protocol Support

- **ActivityPub**: Core protocol for federation
- **WebFinger**: User and instance discovery (RFC 7033)
- **HTTP Signatures**: Request authentication
- **Shared Inbox**: Optimized delivery mechanism

## Instance Actor

Loops implements an instance-level actor to represent the server itself in federation activities.

### Details

- **Username**: The instance domain (e.g., `loops.example.com`)
- **Actor Type**: `Application`
- **Purpose**: 
  - Server-to-server authentication
  - Instance metadata exchange
  - Delete/tombstone notifications
  - Relay subscriptions

### Endpoints

```
GET https://loops.example.com/ap/actor
```

**Response Example:**
```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://loops.example.com/ap/actor",
  "type": "Application",
  "preferredUsername": "loops.example.com",
  "inbox": "https://loops.example.com/ap/actor/inbox",
  "outbox": "https://loops.example.com/ap/actor/outbox",
  "publicKey": {
    "id": "https://loops.example.com/ap/actor#main-key",
    "owner": "https://loops.example.com/ap/actor",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..."
  },
  "manuallyApprovesFollowers": true,
  "url": "https://loops-server.test/about?instance_actor=true"
}
```

## Shared Inbox

Loops implements a shared inbox to optimize federation delivery. Instead of delivering activities to each follower's individual inbox, remote servers can deliver once to the shared inbox.

### Configuration

- **Endpoint**: `POST https://loops.example.com/ap/inbox`
- **Authentication**: HTTP Signatures required
- **Rate Limiting**: Applied per remote instance

### Benefits

- Reduces network overhead
- Improves delivery performance
- Simplifies remote server implementation

### Processing

When an activity arrives at the shared inbox:

1. Verify HTTP signature
2. Validate activity structure
3. Determine target recipients on this instance
4. Queue for processing
5. Distribute to relevant local users

## WebFinger

WebFinger enables discovery of users and their ActivityPub actor endpoints.

### Endpoint

```
GET /.well-known/webfinger?resource=acct:username@loops.example.com
```

### Response Example

```json
{
  "subject": "acct:alice@loops.example.com",
  "aliases": [
    "https://loops.example.com/users/alice",
    "https://loops.example.com/@alice"
  ],
  "links": [
    {
      "rel": "self",
      "type": "application/activity+json",
      "href": "https://loops.example.com/users/alice"
    },
    {
      "rel": "http://webfinger.net/rel/profile-page",
      "type": "text/html",
      "href": "https://loops.example.com/@alice"
    }
  ]
}
```

### Instance WebFinger

The instance actor is also discoverable via WebFinger:

```
GET /.well-known/webfinger?resource=acct:loops.example.com@loops.example.com
```

## Supported Activities

### Outbound Activities

Activities that Loops sends to other federated instances.

#### Create

Sent when a user publishes a new video post.

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "actor": "https://loops.example.com/users/alice",
  "object": {
    "type": "Note",
    "id": "https://loops.example.com/posts/123",
    "attributedTo": "https://loops.example.com/users/alice",
    "content": "Check out this cool video!",
    "url": "https://loops.example.com/posts/123",
    "attachment": [
      {
        "type": "Document",
        "mediaType": "video/mp4",
        "url": "https://loops.example.com/storage/videos/123.mp4"
      }
    ],
    "published": "2024-01-15T12:00:00Z"
  }
}
```

#### Update

Sent when a user updates their profile or edits a post.

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Update",
  "actor": "https://loops.example.com/users/alice",
  "object": {
    "type": "Person",
    "id": "https://loops.example.com/users/alice",
    "name": "Alice Updated",
    "summary": "New bio here"
  }
}
```

#### Delete

Sent when a user deletes a post or account.

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Delete",
  "actor": "https://loops.example.com/users/alice",
  "object": {
    "id": "https://loops.example.com/posts/123",
    "type": "Tombstone"
  }
}
```

#### Follow

Sent when a user follows another account.

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Follow",
  "actor": "https://loops.example.com/users/alice",
  "object": "https://mastodon.social/users/bob"
}
```

#### Accept

Sent in response to a Follow activity (for non-locked accounts).

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Accept",
  "actor": "https://loops.example.com/users/alice",
  "object": {
    "type": "Follow",
    "id": "https://mastodon.social/users/bob/follows/456",
    "actor": "https://mastodon.social/users/bob",
    "object": "https://loops.example.com/users/alice"
  }
}
```

#### Reject

Sent to deny a Follow request (for locked/private accounts).

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Reject",
  "actor": "https://loops.example.com/users/alice",
  "object": {
    "type": "Follow",
    "id": "https://mastodon.social/users/bob/follows/456",
    "actor": "https://mastodon.social/users/bob",
    "object": "https://loops.example.com/users/alice"
  }
}
```

#### Like

Sent when a user likes a post.

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Like",
  "actor": "https://loops.example.com/users/alice",
  "object": "https://mastodon.social/users/bob/statuses/789"
}
```

#### Announce

Sent when a user shares/boosts a post.

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Announce",
  "actor": "https://loops.example.com/users/alice",
  "object": "https://mastodon.social/users/bob/statuses/789",
  "published": "2024-01-15T12:00:00Z"
}
```

#### Undo

Sent to reverse previous activities (unfollow, unlike, unshare).

**Undo Follow:**
```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Undo",
  "actor": "https://loops.example.com/users/alice",
  "object": {
    "type": "Follow",
    "id": "https://loops.example.com/activities/follow/123",
    "actor": "https://loops.example.com/users/alice",
    "object": "https://mastodon.social/users/bob"
  }
}
```

**Undo Like:**
```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Undo",
  "actor": "https://loops.example.com/users/alice",
  "object": {
    "type": "Like",
    "id": "https://loops.example.com/activities/like/456",
    "actor": "https://loops.example.com/users/alice",
    "object": "https://mastodon.social/users/bob/statuses/789"
  }
}
```

**Undo Announce:**
```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Undo",
  "actor": "https://loops.example.com/users/alice",
  "object": {
    "type": "Announce",
    "id": "https://loops.example.com/activities/announce/789",
    "actor": "https://loops.example.com/users/alice",
    "object": "https://mastodon.social/users/bob/statuses/789"
  }
}
```

### Inbound Activities

Activities that Loops processes from other federated instances.

#### Create

Processed when a remote user publishes content. Stored in local database and displayed to followers.

**Supported Object Types:**
- `Note` (text posts)

#### Update

Processed to update remote user profiles and post content.

#### Delete

Processed to remove posts or mark accounts as deleted. Tombstones are created for deleted content.

#### Follow

Processed when a remote user wants to follow a local user. Triggers Accept/Reject response based on account privacy settings.

#### Accept

Processed when a remote user accepts a follow request from a local user.

#### Reject

Processed when a remote user rejects a follow request from a local user.

#### Like

Processed when a remote user likes a local post. Increments like counter and notifies the post author.

#### Announce

Processed when a remote user shares a local post. Increments share counter and notifies the post author.

#### Undo

Processed to reverse previous activities. Handles unfollows, unlikes, and unshares.

#### Block

Processed when a remote user blocks a local user. Removes follow relationships and prevents future interactions.

## Actor Types

Loops supports the following ActivityPub actor types:

- **Person**: Individual user accounts
- **Application**: The instance actor
- **Service**: Bot accounts or automated services
- **Group**: Planned for future group/community support

## Object Types

Supported ActivityStreams object types:

- **Note**: Primary content type for Loops posts (for optimal compatibility)
- **Tombstone**: Deleted content markers

## Security

### HTTP Signatures

All federated requests are signed using HTTP Signatures (draft-cavage-http-signatures).

**Signature Requirements:**
- Algorithm: `rsa-sha256`
- Headers: `(request-target) host date`
- Key size: Minimum 2048 bits RSA

### Verification Process

1. Extract signature from HTTP headers
2. Fetch actor's public key
3. Verify signature matches request
4. Check date header (reject if > 60 minutes old)
5. Process activity if valid

### Domain Blocking

Administrators can block domains to prevent federation with specific instances. Blocked domains:

- Cannot deliver activities to this instance
- Cannot fetch user profiles or posts
- Are filtered from search results
- Have existing content hidden or removed


## Delivery

### Outbound Delivery

Activities are delivered asynchronously using Laravel queues:

1. Activity is queued for delivery
2. Recipients are determined (followers, mentions)
3. Remote inboxes are identified
4. HTTP POST requests are signed and sent
5. Failed deliveries are retried with exponential backoff
6. Permanently failed deliveries are logged

### Retry Policy

- **Initial delay**: 30 seconds
- **Max retries**: 10
- **Backoff**: Exponential (30s, 1m, 5m, 15m)
- **Permanent failure**: After 10 failed attempts

## Collections

### Followers Collection

```
GET https://loops.example.com/ap/users/123/followers
```

Paginated collection of follower actors.

### Following Collection

```
GET https://loops.example.com/ap/users/123/following
```

Paginated collection of actors the user follows.

### Outbox Collection

```
GET https://loops.example.com/ap/users/123/outbox
```

Paginated collection of user's public activities.

## Future Considerations

Planned federation features:

- **Reports/Flag**: Moderation reports across instances
- **Move**: Account migration support
- **Event**: Event federation support
- **Question**: Poll federation

## Testing Federation

### Tools

- **ActivityPub Validator**: Validate actor and activity JSON
- **Federation Tester**: Test delivery and receipt of activities
- **WebFinger Validator**: Verify WebFinger responses

### Manual Testing

Test federation with curl:

```bash
# Fetch actor
curl -H "Accept: application/activity+json" https://loops.example.com/users/123

# WebFinger lookup
curl https://loops.example.com/.well-known/webfinger?resource=acct:alice@loops.example.com
```

## Troubleshooting

### Common Issues

**Activities not delivering:**
- Check queue workers are running
- Verify HTTP signatures are valid
- Check remote instance isn't blocking your domain
- Review delivery logs

**Cannot fetch remote actors:**
- Verify remote instance is online
- Check DNS resolution
- Verify SSL certificates
- Check firewall rules

**WebFinger not working:**
- Ensure `.well-known` route is accessible
- Verify CORS headers if needed
- Check web server configuration
- Verify response format

## References

- [ActivityPub Specification](https://www.w3.org/TR/activitypub/)
- [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)
- [WebFinger RFC 7033](https://tools.ietf.org/html/rfc7033)
- [HTTP Signatures](https://tools.ietf.org/html/draft-cavage-http-signatures)
