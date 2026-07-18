update storage.buckets
set
  file_size_limit = 31457280,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'audio/m4a',
    'audio/mp4',
    'audio/aac',
    'audio/x-m4a'
  ]
where id = 'message-media';

update storage.buckets
set
  file_size_limit = 31457280,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime'
  ]
where id = 'order-photos';
