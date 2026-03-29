from fastapi import FastAPI, UploadFile, File
from paddleocr import PaddleOCR
import uvicorn
import shutil
import os
import uuid

app = FastAPI()

# Initialize PaddleOCR (downloads models on first run)
# use_angle_cls=True helps with rotated text
# lang='en' for English (supports 'ch', 'ka', 'japan', 'korean', etc.)
ocr = PaddleOCR(use_textline_orientation=True, lang='en')

@app.post("/ocr")
async def perform_ocr(file: UploadFile = File(...)):
    # Save uploaded file temporarily
    ext = os.path.splitext(file.filename)[1]
    temp_path = f"temp_{uuid.uuid4().hex}{ext}"
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    try:
        # Run PaddleOCR
        result = ocr.ocr(temp_path)
        
        # Extract text lines and join them
        full_text = ""
        for idx in range(len(result)):
            res = result[idx]
            if res:
                for line in res:
                    full_text += line[1][0] + "\n"
        
        return {"text": full_text.strip()}
    
    except Exception as e:
        return {"error": str(e)}
    
    finally:
        # Cleanup
        if os.path.exists(temp_path):
            os.remove(temp_path)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
