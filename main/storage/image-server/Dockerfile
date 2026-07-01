FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN pip install --no-cache-dir \
    boto3==1.38.46 \
    fastapi==0.115.14 \
    pillow==11.2.1 \
    uvicorn[standard]==0.35.0

COPY app.py /app/app.py

EXPOSE 8080

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
