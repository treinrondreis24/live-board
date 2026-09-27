FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY . ./
ENV PYTHONUNBUFFERED=1 BOOKLETS_DATA=/data
CMD ["sh", "-c", "exec gunicorn --bind '[::]:8080' --workers 1 --threads 4 --timeout 180 --graceful-timeout 180 --limit-request-line 8190 --access-logfile /dev/null cloud:application"]
