-- A NULL departure is the single undated inventory pool for a shop product.
ALTER TABLE tour_session
  MODIFY depart_date DATE NULL,
  ADD COLUMN stock_product_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(depart_date IS NULL, product_id, NULL)) STORED,
  ADD UNIQUE KEY uk_stock_product (stock_product_id);

-- The original physical SKUs used a dated row as inventory. Carry over the
-- remainder of their latest open inventory row, preserving existing orders.
INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult)
SELECT p.id, NULL, COALESCE(s.quota - s.booked, 0), 1, p.price_from
FROM tour_product p
LEFT JOIN tour_session s ON s.id = (
  SELECT t.id FROM tour_session t WHERE t.product_id = p.id
    AND t.status = 1 AND t.depart_date IS NOT NULL
  ORDER BY t.depart_date DESC, t.id DESC LIMIT 1
)
WHERE p.cat = 'shop' AND p.days_desc = '实物';
