import asyncio
import io
import mimetypes
import os
from dataclasses import dataclass
from typing import Iterable

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from PIL import Image, ImageOps


def env(name: str, fallback: str | None = None) -> str:
    value = os.getenv(name)
    if value:
        return value
    if fallback:
        value = os.getenv(fallback)
        if value:
            return value
    return ""


@dataclass(frozen=True)
class Settings:
    endpoint_url: str
    access_key_id: str
    secret_access_key: str
    region: str
    physical_bucket: str
    supabase_prefix: str
    cache_control: str


settings = Settings(
    endpoint_url=env("IMAGE_SERVER_S3_ENDPOINT_URL", "GLOBAL_S3_ENDPOINT"),
    access_key_id=env("IMAGE_SERVER_S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
    secret_access_key=env("IMAGE_SERVER_S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
    region=env("IMAGE_SERVER_S3_REGION", "AWS_DEFAULT_REGION") or env("REGION") or "hel1",
    physical_bucket=env("IMAGE_SERVER_S3_BUCKET", "GLOBAL_S3_BUCKET"),
    supabase_prefix=os.getenv("IMAGE_SERVER_SUPABASE_PREFIX", "storage-single-tenant").strip("/"),
    cache_control=os.getenv(
        "IMAGE_SERVER_CACHE_CONTROL", "public, max-age=31536000, immutable"
    ),
)

if not all(
    [
        settings.endpoint_url,
        settings.access_key_id,
        settings.secret_access_key,
        settings.physical_bucket,
    ]
):
    raise RuntimeError(
        "Missing S3 config. Set IMAGE_SERVER_S3_* or the legacy GLOBAL_S3_*/AWS_* env vars."
    )

s3 = boto3.client(
    "s3",
    endpoint_url=settings.endpoint_url,
    aws_access_key_id=settings.access_key_id,
    aws_secret_access_key=settings.secret_access_key,
    region_name=settings.region,
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)

app = FastAPI(title="Avoin Storage Image Compatibility Server")


def object_key_candidates(logical_bucket: str, object_path: str) -> list[str]:
    object_path = object_path.lstrip("/")
    logical_key = f"{logical_bucket}/{object_path}"
    candidates = [f"{settings.supabase_prefix}/{logical_key}"]

    # Some S3 listings show the legacy image keys as if they were directories.
    # Try the slash-suffixed key as a fallback for those objects.
    candidates.append(f"{settings.supabase_prefix}/{logical_key}/")

    # Harmless fallback for objects copied directly into the physical bucket.
    candidates.append(logical_key)
    candidates.append(f"{logical_key}/")
    return candidates


def client_error_status(error: ClientError) -> int:
    code = error.response.get("Error", {}).get("Code", "")
    status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    if status:
        return int(status)
    if code in {"NoSuchKey", "404", "NotFound"}:
        return 404
    if code in {"AccessDenied", "403"}:
        return 403
    return 500


def find_existing_key(logical_bucket: str, object_path: str) -> tuple[str, dict]:
    last_error: ClientError | None = None
    candidates = object_key_candidates(logical_bucket, object_path)
    for key in candidates:
        try:
            return key, s3.head_object(Bucket=settings.physical_bucket, Key=key)
        except ClientError as error:
            last_error = error
            if client_error_status(error) not in {403, 404}:
                raise

    for key in candidates:
        prefix = f"{key.rstrip('/')}/"
        try:
            listing = s3.list_objects_v2(
                Bucket=settings.physical_bucket,
                Prefix=prefix,
                MaxKeys=1,
            )
        except ClientError as error:
            last_error = error
            if client_error_status(error) not in {403, 404}:
                raise
            continue

        contents = listing.get("Contents") or []
        if not contents:
            continue
        child_key = contents[0]["Key"]
        return child_key, s3.head_object(
            Bucket=settings.physical_bucket, Key=child_key
        )

    if last_error:
        raise last_error
    raise HTTPException(status_code=404, detail="Object not found")


def cors_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, If-None-Match, If-Modified-Since",
        "Accept-Ranges": "bytes",
        "Cache-Control": settings.cache_control,
    }
    if extra:
        headers.update(extra)
    return headers


def object_headers(head: dict) -> dict[str, str]:
    content_type = head.get("ContentType") or "application/octet-stream"
    content_length = head.get("ContentLength")
    headers = {
        "Content-Type": content_type,
    }
    if content_length is not None:
        headers["Content-Length"] = str(content_length)
    if head.get("ETag"):
        headers["ETag"] = head["ETag"]
    if head.get("LastModified"):
        headers["Last-Modified"] = head["LastModified"].strftime(
            "%a, %d %b %Y %H:%M:%S GMT"
        )
    return cors_headers(headers)


def iter_body_chunks(body, chunk_size: int = 1024 * 1024) -> Iterable[bytes]:
    try:
        for chunk in body.iter_chunks(chunk_size=chunk_size):
            if chunk:
                yield chunk
    finally:
        body.close()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.options("/{path:path}")
def options(path: str) -> Response:
    return Response(status_code=204, headers=cors_headers())


async def get_object_response(
    request: Request, logical_bucket: str, object_path: str, head_only: bool = False
) -> Response:
    try:
        key, head = await asyncio.to_thread(
            find_existing_key, logical_bucket, object_path
        )
    except ClientError as error:
        status = client_error_status(error)
        raise HTTPException(status_code=status, detail="Object not found") from error

    headers = object_headers(head)
    if head_only:
        return Response(status_code=200, headers=headers)

    get_kwargs = {"Bucket": settings.physical_bucket, "Key": key}
    if request.headers.get("range"):
        get_kwargs["Range"] = request.headers["range"]

    try:
        obj = await asyncio.to_thread(s3.get_object, **get_kwargs)
    except ClientError as error:
        status = client_error_status(error)
        raise HTTPException(status_code=status, detail="Object not found") from error

    status_code = int(obj.get("ResponseMetadata", {}).get("HTTPStatusCode", 200))
    response_headers = object_headers({**head, **obj})
    if obj.get("ContentRange"):
        response_headers["Content-Range"] = obj["ContentRange"]
        status_code = 206
    if obj.get("ContentLength") is not None:
        response_headers["Content-Length"] = str(obj["ContentLength"])

    return StreamingResponse(
        iter_body_chunks(obj["Body"]),
        status_code=status_code,
        headers=response_headers,
        media_type=response_headers.get("Content-Type"),
    )


@app.get("/object/public/{logical_bucket}/{object_path:path}")
async def get_public_object(
    request: Request, logical_bucket: str, object_path: str
) -> Response:
    return await get_object_response(request, logical_bucket, object_path)


@app.head("/object/public/{logical_bucket}/{object_path:path}")
async def head_public_object(
    request: Request, logical_bucket: str, object_path: str
) -> Response:
    return await get_object_response(request, logical_bucket, object_path, True)


@app.get("/object/{logical_bucket}/{object_path:path}")
async def get_object(request: Request, logical_bucket: str, object_path: str) -> Response:
    return await get_object_response(request, logical_bucket, object_path)


@app.head("/object/{logical_bucket}/{object_path:path}")
async def head_object(
    request: Request, logical_bucket: str, object_path: str
) -> Response:
    return await get_object_response(request, logical_bucket, object_path, True)


def positive_int(value: str | None, default: int | None = None) -> int | None:
    if not value:
        return default
    try:
        parsed = int(float(value))
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def load_object_bytes(logical_bucket: str, object_path: str) -> tuple[bytes, str]:
    key, head = find_existing_key(logical_bucket, object_path)
    obj = s3.get_object(Bucket=settings.physical_bucket, Key=key)
    try:
        return obj["Body"].read(), head.get("ContentType") or ""
    finally:
        obj["Body"].close()


def resize_image(data: bytes, content_type: str, request: Request) -> tuple[bytes, str]:
    width = positive_int(request.query_params.get("width"))
    height = positive_int(request.query_params.get("height"))
    dpr = positive_int(request.query_params.get("dpr"), 1) or 1
    quality = min(max(positive_int(request.query_params.get("quality"), 80) or 80, 1), 100)
    resize = request.query_params.get("resize", "cover")

    if width:
        width *= dpr
    if height:
        height *= dpr

    image = Image.open(io.BytesIO(data))
    image = ImageOps.exif_transpose(image)

    if width or height:
        source_width, source_height = image.size
        target_width = width or max(1, round(source_width * (height or source_height) / source_height))
        target_height = height or max(1, round(source_height * (width or source_width) / source_width))

        if resize == "fill" and width and height:
            image = image.resize((target_width, target_height), Image.Resampling.LANCZOS)
        elif resize == "contain":
            image.thumbnail((target_width, target_height), Image.Resampling.LANCZOS)
        elif width and height:
            image = ImageOps.fit(
                image,
                (target_width, target_height),
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )
        else:
            image.thumbnail((target_width, target_height), Image.Resampling.LANCZOS)

    original_type = content_type or Image.MIME.get(image.format or "")
    has_alpha = image.mode in {"RGBA", "LA"} or (
        image.mode == "P" and "transparency" in image.info
    )

    output = io.BytesIO()
    if original_type == "image/png" or has_alpha:
        if image.mode not in {"RGBA", "LA"}:
            image = image.convert("RGBA")
        image.save(output, format="PNG", optimize=True)
        return output.getvalue(), "image/png"

    if image.mode not in {"RGB", "L"}:
        image = image.convert("RGB")
    image.save(output, format="JPEG", quality=quality, optimize=True, progressive=True)
    return output.getvalue(), "image/jpeg"


async def render_image_response(
    request: Request, logical_bucket: str, object_path: str, head_only: bool = False
) -> Response:
    try:
        data, content_type = await asyncio.to_thread(
            load_object_bytes, logical_bucket, object_path
        )
        rendered, rendered_type = await asyncio.to_thread(
            resize_image, data, content_type, request
        )
    except ClientError as error:
        status = client_error_status(error)
        raise HTTPException(status_code=status, detail="Object not found") from error
    except Exception as error:
        raise HTTPException(status_code=422, detail="Unable to render image") from error

    guessed_type = (
        rendered_type
        or mimetypes.guess_type(object_path)[0]
        or "application/octet-stream"
    )
    headers = cors_headers(
        {
            "Content-Type": guessed_type,
            "Content-Length": str(len(rendered)),
        }
    )
    if head_only:
        return Response(status_code=200, headers=headers)
    return Response(content=rendered, headers=headers, media_type=guessed_type)


@app.get("/render/image/public/{logical_bucket}/{object_path:path}")
async def render_public_image(
    request: Request, logical_bucket: str, object_path: str
) -> Response:
    return await render_image_response(request, logical_bucket, object_path)


@app.head("/render/image/public/{logical_bucket}/{object_path:path}")
async def head_render_public_image(
    request: Request, logical_bucket: str, object_path: str
) -> Response:
    return await render_image_response(request, logical_bucket, object_path, True)
