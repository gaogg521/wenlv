package com.wanderlust.infra.db;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * 轻量 JDBC 访问层（第 0 阶段：无 Spring/MyBatis 环境下的真实落库通道）。
 * 生产由 MyBatis-Plus 替换，服务层接口不变。
 * 事务：withTransaction 内同一 Connection；条件更新用 update() 返回受影响行数判断。
 */
public final class Db {

    private final String url;
    private final String user;
    private final String password;

    public Db(String host, int port, String database, String user, String password) {
        this.url = "jdbc:mysql://" + host + ":" + port + "/" + database
                + "?useUnicode=true&characterEncoding=UTF-8&serverTimezone=Asia/Shanghai"
                + "&useSSL=false&allowPublicKeyRetrieval=true&rewriteBatchedStatements=true";
        this.user = user;
        this.password = password;
    }

    private Connection open() throws SQLException {
        return DriverManager.getConnection(url, user, password);
    }

    /** 在一个事务里执行；异常回滚并抛 RuntimeException */
    public <T> T tx(Function<Connection, T> body) {
        Connection c = null;
        try {
            c = open();
            c.setAutoCommit(false);
            T out = body.apply(c);
            c.commit();
            return out;
        } catch (SQLException e) {
            if (c != null) try { c.rollback(); } catch (SQLException ignore) { }
            throw new DbException("tx failed: " + e.getMessage(), e);
        } finally {
            if (c != null) try { c.close(); } catch (SQLException ignore) { }
        }
    }

    /** 单条增删改（自动提交）；返回受影响行数（条件更新的乐观判断依据） */
    public int update(String sql, Object... params) {
        return tx(c -> update(c, sql, params));
    }

    public int update(Connection c, String sql, Object... params) {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(ps, params);
            return ps.executeUpdate();
        } catch (SQLException e) {
            throw new DbException("update failed: " + sql + " -> " + e.getMessage(), e);
        }
    }

    /** 插入并返回自增 id */
    public long insertReturnId(String sql, Object... params) {
        return tx(c -> insertReturnId(c, sql, params));
    }

    public long insertReturnId(Connection c, String sql, Object... params) {
        try (PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            bind(ps, params);
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                if (rs.next()) return rs.getLong(1);
                throw new DbException("no generated key: " + sql, null);
            }
        } catch (SQLException e) {
            throw new DbException("insert failed: " + sql + " -> " + e.getMessage(), e);
        }
    }

    /** 唯一约束冲突时返回 false（幂等写入的判定基础），其余异常照抛 */
    public boolean tryInsert(Connection c, String sql, Object... params) {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(ps, params);
            ps.executeUpdate();
            return true;
        } catch (SQLException e) {
            if (e.getSQLState() != null && e.getSQLState().startsWith("23")) return false; // 23xxx integrity
            throw new DbException("tryInsert failed: " + sql + " -> " + e.getMessage(), e);
        }
    }

    /** 查询单行（Map，列名->值），无行返回 null */
    public Map<String, Object> queryOne(String sql, Object... params) {
        return tx(c -> queryOne(c, sql, params));
    }

    public Map<String, Object> queryOne(Connection c, String sql, Object... params) {
        List<Map<String, Object>> rows = query(c, sql, params);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public long count(String sql, Object... params) {
        Map<String, Object> m = queryOne(sql, params);
        if (m == null) return 0;
        Object v = m.values().iterator().next();
        return ((Number) v).longValue();
    }

    public List<Map<String, Object>> query(String sql, Object... params) {
        return tx(c -> query(c, sql, params));
    }

    public List<Map<String, Object>> query(Connection c, String sql, Object... params) {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                List<Map<String, Object>> out = new ArrayList<>();
                int cols = rs.getMetaData().getColumnCount();
                while (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    for (int i = 1; i <= cols; i++) {
                        row.put(rs.getMetaData().getColumnLabel(i), rs.getObject(i));
                    }
                    out.add(row);
                }
                return out;
            }
        } catch (SQLException e) {
            throw new DbException("query failed: " + sql + " -> " + e.getMessage(), e);
        }
    }

    private static void bind(PreparedStatement ps, Object[] params) throws SQLException {
        for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
    }

    public static final class DbException extends RuntimeException {
        public DbException(String msg, Throwable cause) { super(msg, cause); }
    }
}
