from pathlib import Path
from pypdf import PdfReader
from PIL import Image
source=Path('output/ees-hr-v7/synthetic-meeting.pdf')
reader=PdfReader(source)
print('Synthetic report pages:',len(reader.pages))
for index,page in enumerate(reader.pages):
    image=next(iter(page.images))
    dest=source.with_name(f'synthetic-meeting-page-{index+1}.png')
    image.image.save(dest)
    print(dest)
