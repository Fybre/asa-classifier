# Use a Python 3.10 image for PaddleOCR compatibility
FROM python:3.10-slim

# Install system dependencies (Paddle requires several libraries)
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    python3-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Install Paddle and PaddleOCR
# Use the CPU version of PaddlePaddle (smaller, easier to run on standard hardware)
RUN pip install --no-cache-dir \
    paddlepaddle \
    paddleocr \
    fastapi \
    uvicorn \
    python-multipart

# Copy the API wrapper
COPY paddle_api.py .

# Expose port 8080
EXPOSE 8080

# Command to run the service
CMD ["python3", "paddle_api.py"]
