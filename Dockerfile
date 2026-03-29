# Stage 1: Build the React frontend
FROM node:20-slim AS builder

WORKDIR /app/frontend

COPY frontend/package.json ./
RUN npm install

COPY frontend/ .
RUN npm run build


# Stage 2: Python backend
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV OPENAI_API_BASE="https://api.openai.com/v1"
ENV OPENAI_API_KEY="your-api-key-here"
ENV LLM_MODEL="gpt-4o"

# Install system dependencies
# - tesseract-ocr: for the local OCR engine
# - libgl1: for some computer vision libraries (like Paddle/DocTR)
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY . .

# Copy the built React frontend from the builder stage
COPY --from=builder /app/frontend/dist ./frontend/dist

# Ensure the local directories exist for the container
RUN mkdir -p docs/input docs/processed docs/training_archive asa_vector_db

# Pre-download the small embedding model so the container is ready at startup
RUN python3 -c "from langchain_huggingface import HuggingFaceEmbeddings; HuggingFaceEmbeddings(model_name='sentence-transformers/all-MiniLM-L6-v2')"

# Expose the FastAPI port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
