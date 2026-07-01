# Storage

This stack runs SeaweedFS as the S3-compatible storage layer for
`storage.avoin.org`. The previous Supabase Storage stack is still present in
`docker-compose.yml` under the `legacy-supabase` profile so it can be used for
rollback or for one-time migration reads.

The stack also runs `storage-image-server`, a small compatibility server for
legacy Supabase public image URLs used by Avoin Map's Luonnonmetsakartat
applet. It handles:

```text
/object/public/<bucket>/<key>
/render/image/public/<bucket>/<key>?width=...&height=...&resize=...&quality=...&dpr=...
```

Those routes are intentionally separate from the SeaweedFS S3 endpoint. Traefik
routes only those legacy path prefixes to `storage-image-server`; all other
`storage.avoin.org` traffic goes to SeaweedFS.

## Runtime files

Create these files on the server before starting the stack:

- `.env` from `.env.template`
- `s3.json` from `s3.json.template`

`s3.json` is intentionally ignored by git because it contains live S3 access
keys. Use bucket-scoped identities for application access. For example, the
GeoServer `hiilikartta` store only needs:

```json
[
  "Read:hiilikartta",
  "List:hiilikartta"
]
```

## Deploy

From `main/storage`:

```sh
docker compose up -d seaweedfs image-server
```

Traefik exposes SeaweedFS through the existing storage router. In
`main/proxy/.env`, set:

```sh
STORAGE_URL=http://seaweedfs:8333
STORAGE_IMAGE_SERVER_URL=http://storage-image-server:8080
```

Then restart Traefik:

```sh
cd ../proxy
docker compose up -d traefik
```

The public S3 endpoint is:

```text
https://storage.avoin.org
```

Use path-style buckets for clients that support it.

## Legacy Public Images

The compatibility image server reads legacy Supabase-backed image objects from
the old physical S3 bucket configured in `.env`:

```sh
GLOBAL_S3_BUCKET=avoin
GLOBAL_S3_ENDPOINT=https://hel1.your-objectstorage.com
AWS_ACCESS_KEY_ID=<old S3 access key>
AWS_SECRET_ACCESS_KEY=<old S3 secret key>
IMAGE_SERVER_SUPABASE_PREFIX=storage-single-tenant
```

For example:

```text
https://storage.avoin.org/object/public/luonnonmetsakartat-<layer-id>/<area-id>/<picture-id>.jpg
```

is served from:

```text
s3://$GLOBAL_S3_BUCKET/$IMAGE_SERVER_SUPABASE_PREFIX/luonnonmetsakartat-<layer-id>/<area-id>/<picture-id>.jpg
```

The render route resizes with Pillow and returns JPEG or PNG. It exists so the
current Avoin Map frontend can keep using its Supabase-style
`/object/` -> `/render/image/` URL replacement until the application is moved to
a direct image URL helper.

## Hiilikartta migration

The only object that GeoServer currently needs is:

```text
s3://hiilikartta/hiilikartta_kasvillisuudenhiili_2021_tcha_3857.cog.tif
```

Copy it from the legacy Supabase S3 endpoint to SeaweedFS before switching
GeoServer. One safe approach is to run a temporary `rclone/rclone` container on
the Docker network shared by both storage services, with the source remote
pointing at `http://supabase-storage:5000/s3` and the destination remote
pointing at `http://seaweedfs:8333`.

After upload, verify:

- `HeadObject` reports `ContentLength=4005707773`
- a range GET for `bytes=0-16383` returns `206 Partial Content`
- GeoServer can render
  `hiilikartta:kasvillisuudenhiili_2021_tcha`

GeoServer uses the ImageIO S3 range reader through these environment variables:

```sh
IIO_S3_AWS_ENDPOINT=https://storage.avoin.org
IIO_S3_AWS_REGION=us-east-1
IIO_S3_AWS_FORCE_PATH_STYLE=true
IIO_S3_AWS_USER=<bucket-scoped access key>
IIO_S3_AWS_PASSWORD=<bucket-scoped secret key>
```

## Rollback

If SeaweedFS has to be rolled back, point Traefik back to Supabase Storage:

```sh
STORAGE_URL=http://supabase-storage:5000
```

Then restart Traefik and restore GeoServer's previous S3 credentials and
endpoint:

```sh
IIO_S3_AWS_ENDPOINT=https://storage.avoin.org/s3
IIO_S3_AWS_REGION=hel1
IIO_S3_AWS_FORCE_PATH_STYLE=true
```

The legacy containers can be started explicitly with:

```sh
docker compose --profile legacy-supabase up -d
```
