import json
import os
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_core.documents import Document

# 1. Configuration
KB_FILE = "asa_classification_kb.json"
CHROMA_PATH = "asa_vector_db"
# This model is small (~90MB), fast, and runs locally on CPU
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

def load_kb_to_vector_store():
    # Initialize embeddings
    print(f"Loading local embedding model: {EMBEDDING_MODEL}...")
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)

    # Load the JSON Knowledge Base
    with open(KB_FILE, 'r') as f:
        kb_data = json.load(f)

    # Convert JSON entries into LangChain Documents
    documents = []
    for entry in kb_data:
        # Create a rich text representation for semantic search
        # We include hierarchy, description and examples to give the embedder more context
        content = f"Hierarchy: {entry['hierarchy']}\n" \
                  f"Description: {entry['category_description']}\n" \
                  f"Examples: {entry['examples_of_records']}"
        
        # Metadata is preserved so we can retrieve the exact fields later
        doc = Document(
            page_content=content,
            metadata={
                "hierarchy": entry['hierarchy'],
                "disposal": entry['disposal_action']
            }
        )
        documents.append(doc)

    # Create (or load) the vector store
    print(f"Ingesting {len(documents)} entries into ChromaDB at {CHROMA_PATH}...")
    vector_store = Chroma.from_documents(
        documents=documents,
        embedding=embeddings,
        persist_directory=CHROMA_PATH
    )
    print("Ingestion complete.")
    return vector_store

def classify_document(ocr_text, vector_store, top_k=3):
    """
    Simulates a classification task:
    1. Retrieve top-K relevant ASA categories via RAG
    2. Format a prompt for a local LLM (like Ollama)
    """
    
    # RAG: Retrieve contextually relevant ASA categories
    results = vector_store.similarity_search(ocr_text, k=top_k)
    
    # Prepare the context for the LLM
    context_chunks = []
    for i, res in enumerate(results):
        context_chunks.append(f"Option {i+1}:\n{res.page_content}\n")
    
    context_text = "\n".join(context_chunks)
    
    # This is the prompt you would send to Ollama/Llama-3 locally
    llm_prompt = f"""
SYSTEM: You are a professional school records archivist. 
Your task is to classify the provided DOCUMENT TEXT into the most appropriate ASA classification category.

REFERENCE CLASSIFICATIONS (RAG Context):
{context_text}

DOCUMENT TEXT TO CLASSIFY:
\"\"\"
{ocr_text}
\"\"\"

INSTRUCTION: 
Review the document text and the reference options. 
Select exactly ONE ASA hierarchy from the options that best fits the document.
Output only a valid JSON object with the following keys: 'asa_code', 'reasoning', 'confidence_score'.
"""
    return llm_prompt, results

if __name__ == "__main__":
    # If the database doesn't exist, create it
    if not os.path.exists(CHROMA_PATH):
        db = load_kb_to_vector_store()
    else:
        print("Loading existing ChromaDB...")
        embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
        db = Chroma(persist_directory=CHROMA_PATH, embedding_function=embeddings)

    # --- TEST CASE ---
    # Imagine this is the messy text from an OCR'd student enrollment document
    sample_ocr_text = """
    Application for Enrolment - Year 7 2024
    Student Name: John Smith, DOB: 12/05/2012
    Address: 123 School Lane, Sydney.
    Parent/Guardian: Jane Smith.
    The student has previously attended West Sydney Primary School.
    Included: Copy of birth certificate and latest NAPLAN report.
    Decision: Application Approved - Start Date Jan 29 2024.
    """

    print("\n--- Testing RAG Classification ---")
    prompt, matches = classify_document(sample_ocr_text, db)
    
    print(f"\nTop Match found via semantic search: {matches[0].metadata['hierarchy']}")
    print(f"Disposal Rule for this match: {matches[0].metadata['disposal']}")
    
    print("\n--- Generated Local LLM Prompt ---")
    print(prompt)
