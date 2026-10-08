"""Use the displayed PDF page coordinates for overlays, retaining source files."""
from pypdf import Transformation
from pypdf.generic import RectangleObject, NameObject


def display_meta(meta):
    result = []
    for item in meta:
        crop = item.get('crop', [0, 0, item['width'], item['height']])
        width, height = float(crop[2])-float(crop[0]), float(crop[3])-float(crop[1])
        if item.get('rotation', 0) % 180:
            width, height = height, width
        result.append({**item, 'width': width, 'height': height,
                       'rotation': 0, 'crop': [0, 0, width, height]})
    return result


def transform_links(page, transform):
    for ref in page.get('/Annots', []):
        annotation = ref.get_object()
        if '/Rect' in annotation:
            rect = annotation['/Rect']
            points = [transform.apply_on((float(rect[x]), float(rect[y])))
                      for x, y in ((0, 1), (0, 3), (2, 1), (2, 3))]
            annotation[NameObject('/Rect')] = RectangleObject([
                min(p[0] for p in points), min(p[1] for p in points),
                max(p[0] for p in points), max(p[1] for p in points)])
        if '/QuadPoints' in annotation:
            from pypdf.generic import ArrayObject, FloatObject
            old = annotation['/QuadPoints']
            annotation[NameObject('/QuadPoints')] = ArrayObject([
                FloatObject(value) for index in range(0, len(old), 2)
                for value in transform.apply_on((float(old[index]), float(old[index+1])))])


def normalize_page(page):
    if page.rotation:
        media = page.mediabox
        transform = Transformation().translate(
            -float(media.left+media.width/2), -float(media.bottom+media.height/2)
        ).rotate(-page.rotation)
        a, b = transform.apply_on(media.lower_left), transform.apply_on(media.upper_right)
        transform = transform.translate(-min(a[0], b[0]), -min(a[1], b[1]))
        transform_links(page, transform)
        page.transfer_rotation_to_content()
    x, y = float(page.cropbox.left), float(page.cropbox.bottom)
    width, height = float(page.cropbox.width), float(page.cropbox.height)
    if x or y:
        transform = Transformation().translate(-x, -y)
        page.add_transformation(transform)
        transform_links(page, transform)
    # Preserve exactly the displayed crop, including any visible Canva bleed.
    for box in ('mediabox', 'cropbox', 'trimbox', 'bleedbox', 'artbox'):
        setattr(page, box, RectangleObject([0, 0, width, height]))
    return page
