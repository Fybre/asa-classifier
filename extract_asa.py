import pandas as pd
import json
import math

def clean_text(val):
    if pd.isna(val):
        return ""
    return str(val).strip()

def process_asa_excel(file_path, output_json_path):
    df = pd.read_excel(file_path, sheet_name='RRDS-NGS')
    
    rag_documents = []
    
    current_function = ""
    current_class = ""
    current_subclass_1 = ""
    
    for index, row in df.iterrows():
        func = clean_text(row.get('Function'))
        cls_desc = clean_text(row.get('Class & Description'))
        subcls_desc = clean_text(row.get('Sub class & Description'))
        subcls_desc2 = clean_text(row.get('Sub class & Description.1'))
        
        disposal = clean_text(row.get('Disposal Action'))
        examples = clean_text(row.get('Examples of Records'))
        
        # Skip completely empty rows
        if not func and not cls_desc and not subcls_desc and not subcls_desc2:
            continue
            
        # Update hierarchy trackers
        if func and not cls_desc:
            # This is a top-level function definition (e.g. "GOVERNANCE - managing...")
            current_function = func
            current_class = ""
            current_subclass_1 = ""
            continue
        elif func:
            current_function = func
            
        if cls_desc and not subcls_desc:
            current_class = cls_desc
            current_subclass_1 = ""
        elif cls_desc:
            current_class = cls_desc
            
        if subcls_desc and not subcls_desc2:
            current_subclass_1 = subcls_desc
        elif subcls_desc:
            current_subclass_1 = subcls_desc
            
        # Determine the lowest level definition for this row
        if subcls_desc2:
            title_desc = subcls_desc2
            hierarchy = f"{current_function.split(' - ')[0]} > {current_class.split(' - ')[0]} > {current_subclass_1.split(' - ')[0]} > {title_desc.split(' - ')[0]}"
        elif subcls_desc:
            title_desc = subcls_desc
            hierarchy = f"{current_function.split(' - ')[0]} > {current_class.split(' - ')[0]} > {title_desc.split(' - ')[0]}"
        elif cls_desc:
            title_desc = cls_desc
            hierarchy = f"{current_function.split(' - ')[0]} > {title_desc.split(' - ')[0]}"
        else:
            continue
            
        # Only add entries that have a disposal action or examples, as these are actionable categories
        if disposal or examples:
            doc = {
                "hierarchy": hierarchy,
                "category_description": title_desc,
                "disposal_action": disposal,
                "examples_of_records": examples
            }
            rag_documents.append(doc)

    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(rag_documents, f, indent=4)
        
    print(f"Successfully exported {len(rag_documents)} classifications to {output_json_path}")

if __name__ == "__main__":
    import warnings
    warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')
    process_asa_excel('docs/ASA RRDS 2.xlsm', 'asa_classification_kb.json')
