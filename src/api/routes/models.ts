import _ from 'lodash';
import Response from '@/lib/response/Response.ts';
import Request from '@/lib/request/Request.ts';
import { tokenSplit } from '@/api/controllers/core.ts';

// 图像模型映射
export const IMAGE_MODEL_MAP = {
    "jimeng-4.1": "high_aes_general_v41",
    "jimeng-4.0": "high_aes_general_v40",
    "jimeng-3.1": "high_aes_general_v30l_art:general_v3.0_18b",
    "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b",
    "jimeng-2.1": "high_aes_general_v21_L:general_v2.1_L",
    "jimeng-2.0-pro": "high_aes_general_v20_L:general_v2.0_L",
    "jimeng-2.0": "high_aes_general_v20:general_v2.0",
    "jimeng-1.4": "high_aes_v14_dreamina:general_v1.4",
    "jimeng-xl-pro": "text2img_xl_sft",
    "jimeng-nano-banana": "external_model_gemini_flash_image_v25",
    "jimeng-nano-banana-pro": "dreamina_image_lib_1",
};

// 视频模型映射
export const VIDEO_MODEL_MAP = {
    "jimeng-video-3.0-pro": "dreamina_ic_generate_video_model_vgfm_3.0_pro",
    "jimeng-video-3.0-fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
    "jimeng-video-3.0": "dreamina_ic_generate_video_model_vgfm_3.0",
    "jimeng-video-s2.0-pro": "dreamina_ic_generate_video_model_vgfm1.0",
    "jimeng-video-sora2": "dreamina_sora2_generate_video",
    "jimeng-video-veo3.1": "dreamina_veo31_generate_video",
    "jimeng-video-veo3": "dreamina_veo3_generate_video",
};

export default {

    prefix: '/v1',

    get: {
        '/models': async (request: Request) => {
            // 根据 Authorization 判定区域：CN 使用 suffix ":cn"
            const auth = request?.headers?.authorization as string | undefined;
            const tokens = auth ? tokenSplit(auth) : [];
            const picked = _.sample(tokens) || '';
            const isCN = /:cn$/i.test(picked);

            const COMMON_FIELDS = {
                object: 'model',
                owned_by: 'dreamina-free-api',
            } as const;

            // 国际区模型列表
            const INTL = [
                {
                    id: 'jimeng-4.1',
                    model_name: '图片 4.1',
                    model_tip: '最新图像生成模型',
                    model_req_key: 'high_aes_general_v41',
                },
                {
                    id: 'jimeng-4.0',
                    model_name: '图片 4.0',
                    model_tip: '支持多参考图、系列组图生成',
                    model_req_key: 'high_aes_general_v40',
                },
                {
                    id: 'jimeng-3.1',
                    model_name: 'Image 3.1',
                    model_tip: 'Delivers striking visuals with rich, versatile aesthetics.',
                    model_req_key: 'high_aes_general_v30l_art:general_v3.0_18b',
                },
                {
                    id: 'jimeng-3.0',
                    model_name: 'Image 3.0',
                    model_tip: 'Studio quality, precise text generation, native 2K resolution.',
                    model_req_key: 'high_aes_general_v30l:general_v3.0_18b',
                },
                {
                    id: 'jimeng-2.1',
                    model_name: 'Image 2.1',
                    model_tip: 'Great for graphic design. Supports text generation.',
                    model_req_key: 'high_aes_general_v21_L:general_v2.1_L',
                },
                {
                    id: 'jimeng-2.0-pro',
                    model_name: 'Image 2.0 Pro',
                    model_tip: 'Imaginative and creative. Excels at photorealism.',
                    model_req_key: 'high_aes_general_v20_L:general_v2.0_L',
                },
                {
                    id: 'jimeng-1.4',
                    model_name: 'Image 1.4',
                    model_tip: 'Versatile for all styles. Supports natural language prompts.',
                    model_req_key: 'high_aes_v14_dreamina:general_v1.4',
                },
                {
                    id: 'jimeng-nano-banana',
                    model_name: 'Nano Banana',
                    model_tip: 'Fast and efficient image generation powered by Gemini Flash.',
                    model_req_key: 'external_model_gemini_flash_image_v25',
                },
                {
                    id: 'jimeng-nano-banana-pro',
                    model_name: 'Nano Banana Pro',
                    model_tip: 'Enhanced image generation with advanced image library features.',
                    model_req_key: 'dreamina_image_lib_1',
                },
                {
                    id: 'jimeng-video-3.0-pro',
                    model_name: 'Video 3.0 Pro',
                    model_tip: 'Best-in-class performance, ultra-clear visuals.',
                    model_req_key: 'dreamina_ic_generate_video_model_vgfm_3.0_pro',
                },
                {
                    id: 'jimeng-video-3.0-fast',
                    model_name: 'Video 3.0 Fast',
                    model_tip: 'Film-level performance, faster and more credit-efficient.',
                    model_req_key: 'dreamina_ic_generate_video_model_vgfm_3.0_fast',
                },
                {
                    id: 'jimeng-video-3.0',
                    model_name: 'Video 3.0',
                    model_tip: 'Creates multiple scenes with one detailed prompt.',
                    model_req_key: 'dreamina_ic_generate_video_model_vgfm_3.0',
                },
                {
                    id: 'jimeng-video-s2.0-pro',
                    model_name: 'Video S2.0 Pro',
                    model_tip: 'Realistic motion and natural camera movement.',
                    model_req_key: 'dreamina_ic_generate_video_model_vgfm1.0',
                },
                {
                    id: 'jimeng-video-sora2',
                    model_name: 'Sora 2',
                    model_tip: 'OpenAI\'s latest model. (face-generation is not supported)',
                    model_req_key: 'dreamina_sora2_generate_video',
                },
                {
                    id: 'jimeng-video-veo3.1',
                    model_name: 'Veo 3.1',
                    model_tip: 'Google\'s latest video generation model, now with native audio.',
                    model_req_key: 'dreamina_veo31_generate_video',
                },
                {
                    id: 'jimeng-video-veo3',
                    model_name: 'Veo 3',
                    model_tip: 'Google\'s video generation model, now with native audio.',
                    model_req_key: 'dreamina_veo3_generate_video',
                },
                {
                    id: 'agent',
                    model_name: 'Agent',
                    model_tip: 'CapCut conversation SSE proxy (OpenAI-style stream).',
                    model_req_key: 'capcut_conversation_v2',
                },
            ].map(m => ({ ...COMMON_FIELDS, ...m }));

            // CN 区域模型列表（对齐到现有格式）
            const CN = [
                {
                    id: 'jimeng-4.1',
                    model_name: '图片 4.1',
                    model_tip: '最新图像生成模型',
                    model_req_key: 'high_aes_general_v41',
                },
                {
                    id: 'jimeng-4.0',
                    model_name: '图片 4.0',
                    model_tip: '支持多参考图、系列组图生成',
                    model_req_key: 'high_aes_general_v40',
                },
                {
                    id: 'jimeng-3.1',
                    model_name: '图片 3.1',
                    model_tip: '丰富的美学多样性，画面更鲜明生动',
                    model_req_key: 'high_aes_general_v30l_art_fangzhou:general_v3.0_18b',
                },
                {
                    id: 'jimeng-3.0',
                    model_name: '图片 3.0',
                    model_tip: '影视质感，文字更准，直出2k高清图',
                    model_req_key: 'high_aes_general_v30l:general_v3.0_18b',
                },
                {
                    id: 'jimeng-2.1',
                    model_name: '图片 2.1',
                    model_tip: '平面绘感强，可生成文字海报',
                    model_req_key: 'high_aes_general_v21_L:general_v2.1_L',
                },
                {
                    id: 'jimeng-2.0-pro',
                    model_name: '图片 2.0 Pro',
                    model_tip: '极具想象力，擅长写真摄影',
                    model_req_key: 'high_aes_general_v20_L:general_v2.0_L',
                },
                {
                    id: 'jimeng-2.0',
                    model_name: '图片 2.0',
                    model_tip: '文字遵循高，支持图片参考能力',
                    model_req_key: 'high_aes_general_v20:general_v2.0',
                },
                {
                    id: 'jimeng-nano-banana',
                    model_name: 'Nano Banana',
                    model_tip: '快速高效的图片生成，由 Gemini Flash 驱动',
                    model_req_key: 'external_model_gemini_flash_image_v25',
                },
                {
                    id: 'jimeng-nano-banana-pro',
                    model_name: 'Nano Banana Pro',
                    model_tip: '增强型图片生成，支持高级图片库功能',
                    model_req_key: 'dreamina_image_lib_1',
                },
                {
                    id: 'jimeng-video-3.0-pro',
                    model_name: '视频 3.0 Pro',
                    model_tip: '顶级性能，超清视觉效果',
                    model_req_key: 'dreamina_ic_generate_video_model_vgfm_3.0_pro',
                },
                {
                    id: 'jimeng-video-3.0-fast',
                    model_name: '视频 3.0 Fast',
                    model_tip: '电影级性能，更快更省积分',
                    model_req_key: 'dreamina_ic_generate_video_model_vgfm_3.0_fast',
                },
                {
                    id: 'jimeng-video-3.0',
                    model_name: '视频 3.0',
                    model_tip: '用详细提示词创建多场景视频',
                    model_req_key: 'dreamina_ic_generate_video_model_vgfm_3.0',
                },
                {
                    id: 'jimeng-video-s2.0-pro',
                    model_name: '视频 S2.0 Pro',
                    model_tip: '真实动作和自然镜头运动',
                    model_req_key: 'dreamina_ic_generate_video_model_vgfm1.0',
                },
                {
                    id: 'jimeng-video-sora2',
                    model_name: 'Sora 2',
                    model_tip: 'OpenAI 最新模型（不支持人脸生成）',
                    model_req_key: 'dreamina_sora2_generate_video',
                },
                {
                    id: 'jimeng-video-veo3.1',
                    model_name: 'Veo 3.1',
                    model_tip: 'Google 最新视频生成模型，原生支持音频',
                    model_req_key: 'dreamina_veo31_generate_video',
                },
                {
                    id: 'jimeng-video-veo3',
                    model_name: 'Veo 3',
                    model_tip: 'Google 视频生成模型，原生支持音频',
                    model_req_key: 'dreamina_veo3_generate_video',
                },
                {
                    id: 'agent',
                    model_name: '会话代理',
                    model_tip: '代理 CapCut 会话 SSE，返回 OpenAI 风格流式。',
                    model_req_key: 'capcut_conversation_v2',
                },
            ].map(m => ({ ...COMMON_FIELDS, ...m }));

            const payload = { data: isCN ? CN : INTL };
            return new Response(payload, {
                headers: {
                    // 缓存 5 分钟，减轻频繁请求带来的 I/O 和日志开销
                    'Cache-Control': 'public, max-age=300'
                }
            });
        }

    }
}
