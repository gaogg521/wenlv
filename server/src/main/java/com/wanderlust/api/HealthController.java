package com.wanderlust.api;

import com.wanderlust.common.Result;
import com.wanderlust.module.attestation.AttestationClient;
import com.wanderlust.module.attestation.NoopAttestationClient;
import com.wanderlust.infra.config.ConfigService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 健康与自检：验证配置中心/存证骨架装配正常（后续各域 controller 按此模式挂载） */
@RestController
@RequestMapping("/c")
public class HealthController {

    private final ConfigService config = new ConfigService();
    private final AttestationClient attest = new NoopAttestationClient();

    @GetMapping("/health")
    public Result<Map<String, Object>> health() {
        return Result.ok(Map.of(
                "app", "wanderlust-server",
                "version", "0.1.0",
                "bean_order_rate", config.raw("bean.order_rate"),
                "promoter_rate_bp", config.raw("promoter.rate_bp"),
                "attestation", attest.getClass().getSimpleName()
        ));
    }
}
