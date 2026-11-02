-- 既有下架笔记也可申请复核；明确原原因缺失，不伪造历史人工判定。
INSERT INTO content_moderation(note_id,city_code,reason,snapshot,actor)
  SELECT n.id,p.city_code,'历史下架记录，原处理原因未留存，可申请复核',
    JSON_OBJECT('title',n.title,'body',n.body),'system:legacy-import'
  FROM content_note n LEFT JOIN tour_product p ON p.id=n.related_product_id
  WHERE n.status=4 AND n.moderation_id IS NULL;
UPDATE content_note n JOIN content_moderation m ON m.note_id=n.id AND m.actor='system:legacy-import'
  SET n.moderation_id=m.id WHERE n.status=4 AND n.moderation_id IS NULL;
