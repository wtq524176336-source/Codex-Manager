<template>
  <div class="page author-page">
    <section class="author-hero">
      <div class="author-hero__eyebrow">
        <el-icon><MagicStick /></el-icon>
        <span>赞助与推荐</span>
      </div>
      <h2>赞助与推荐</h2>
      <p>这里集中展示 README 里的赞助信息、推荐服务，以及作者联系入口。</p>
    </section>

    <el-tabs v-model="activeTab" class="author-tabs">
      <el-tab-pane label="赞助 / 推荐" name="sponsor">
        <div class="author-section-grid">
          <section v-if="visibleSponsors.length" class="author-card">
            <div class="author-card__head">
              <el-icon><Promotion /></el-icon>
              <div>
                <h3>赞助商</h3>
                <p>沿用 README 的展示内容，并同步星思研邀请链接。</p>
              </div>
            </div>
            <div class="partner-table">
              <div v-for="item in visibleSponsors" :key="item.key" class="partner-row">
                <div class="partner-visual">
                  <img v-if="item.imageSrc" :src="item.imageSrc" :alt="item.imageAlt || item.name" />
                  <span v-else>Sponsor</span>
                </div>
                <div class="partner-content">
                  <h4>{{ item.name }}</h4>
                  <p>{{ item.description }}</p>
                  <el-button type="primary" plain round @click="openLink(item.href)">
                    {{ item.actionLabel || "打开链接" }}
                    <el-icon><Link /></el-icon>
                  </el-button>
                </div>
              </div>
            </div>
          </section>

          <section v-if="visibleServerRecommendations.length" class="author-card">
            <div class="author-card__head">
              <el-icon><Monitor /></el-icon>
              <div>
                <h3>服务器推荐</h3>
                <p>补充一个常用服务器选择，便于直接部署或长期运行服务。</p>
              </div>
            </div>
            <div class="partner-table">
              <div v-for="item in visibleServerRecommendations" :key="item.key" class="partner-row">
                <div class="partner-visual">
                  <img v-if="item.imageSrc" :src="item.imageSrc" :alt="item.imageAlt || item.name" />
                  <span v-else>RackNerd</span>
                </div>
                <div class="partner-content">
                  <h4>{{ item.name }}</h4>
                  <p>{{ item.description }}</p>
                  <el-button type="primary" plain round @click="openLink(item.href)">
                    {{ item.actionLabel || "打开链接" }}
                    <el-icon><Link /></el-icon>
                  </el-button>
                </div>
              </div>
            </div>
          </section>

          <section v-if="!visibleSponsors.length && !visibleServerRecommendations.length" class="author-card">
            <div class="author-card__head">
              <el-icon><InfoFilled /></el-icon>
              <div>
                <h3>内容加载中</h3>
                <p>远程赞助和推荐内容加载失败时，这里会保留联系作者入口。</p>
              </div>
            </div>
          </section>
        </div>
      </el-tab-pane>

      <el-tab-pane label="联系作者" name="contact">
        <div class="contact-grid">
          <section class="author-card">
            <div class="author-card__head">
              <el-icon><Message /></el-icon>
              <div>
                <h3>联系作者</h3>
                <p>遇到问题、建议或定制需求，可以通过以下方式联系。</p>
              </div>
            </div>
            <div class="contact-list">
              <div>
                <span>微信</span>
                <strong>{{ authorWechatId }}</strong>
              </div>
              <div class="wechat-qr">
                <img src="/author-wechat.jpg" alt="作者微信二维码" />
              </div>
              <div>
                <span>Telegram 群组</span>
                <el-button link type="primary" @click="openLink(authorTelegramGroupUrl)">
                  打开群组
                </el-button>
              </div>
            </div>
          </section>

          <section class="author-card support-card">
            <div class="author-card__head">
              <el-icon><Money /></el-icon>
              <div>
                <h3>赞助支持</h3>
                <p>项目持续维护、修问题和做适配，欢迎随缘支持。</p>
              </div>
            </div>
            <div class="support-grid">
              <div v-for="item in supportImages" :key="item.key" class="support-item">
                <div class="support-placeholder">
                  <img :src="item.src" :alt="item.title" />
                </div>
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
              </div>
            </div>
          </section>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { InfoFilled, Link, MagicStick, Message, Money, Monitor, Promotion } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { computed, onMounted, onUnmounted, ref } from "vue";

import { getErrorMessage } from "@/api/http";
import { openInBrowser } from "@/api/system";

interface SponsorLinkItem {
  key: string;
  name: string;
  description: string;
  href: string;
  actionLabel?: string;
  imageSrc?: string;
  imageAlt?: string;
}

const authorWechatId = "ProsperGao";
const authorTelegramGroupUrl = "https://t.me/+OdpFa9GvjxhjMDhl";
const authorContentApi = "https://author.qxnm.top/api/public/author-content";
const activeTab = ref("sponsor");
const authorContent = ref<{
  authorSponsors: SponsorLinkItem[];
  authorServerRecommendations: SponsorLinkItem[];
} | null>(null);
const supportImages = [
  {
    key: "alipay",
    title: "支付宝赞助码",
    description: "如果这个项目帮你省了时间，可以请作者喝杯咖啡。",
    src: "/author-alipay.jpg",
  },
  {
    key: "wechat-pay",
    title: "微信赞助码",
    description: "项目持续维护、修问题和做适配，欢迎随缘支持。",
    src: "/author-wechat-pay.jpg",
  },
];
const visibleSponsors = computed(() => authorContent.value?.authorSponsors || []);
const visibleServerRecommendations = computed(() => authorContent.value?.authorServerRecommendations || []);

async function loadContent() {
  try {
    const response = await fetch(authorContentApi, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    authorContent.value = {
      authorSponsors: normalizeSponsorItems(payload?.authorSponsors),
      authorServerRecommendations: normalizeSponsorItems(payload?.authorServerRecommendations),
    };
  } catch {
    authorContent.value = {
      authorSponsors: [],
      authorServerRecommendations: [],
    };
  }
}

function normalizeSponsorItems(value: unknown): SponsorLinkItem[] {
  if (!Array.isArray(value)) return [];
  const result: SponsorLinkItem[] = [];
  value.forEach((item, index) => {
    const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const href = String(source.href || source.url || "").trim();
    const name = String(source.name || source.title || "").trim();
    if (!href || !name) return;
    result.push({
      key: String(source.key || `${name}-${index}`),
      name,
      description: String(source.description || ""),
      href,
      actionLabel: String(source.actionLabel || source.action || "打开链接"),
      imageSrc: String(source.imageSrc || source.image || ""),
      imageAlt: String(source.imageAlt || name),
    });
  });
  return result;
}

async function openLink(url: string) {
  try {
    await openInBrowser(url);
  } catch (error) {
    ElMessage.error(`打开链接失败：${getErrorMessage(error)}`);
  }
}

let refreshTimer: number | undefined;

onMounted(() => {
  void loadContent();
  refreshTimer = window.setInterval(() => void loadContent(), 5 * 60 * 1000);
});

onUnmounted(() => {
  if (refreshTimer !== undefined) {
    window.clearInterval(refreshTimer);
  }
});
</script>

<style scoped lang="scss">
.author-page {
  gap: 18px;

  .author-hero {
    display: grid;
    gap: 8px;

    &__eyebrow {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--primary);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.18em;
    }

    h2 {
      margin: 0;
      font-size: 24px;
    }

    p {
      margin: 0;
      color: var(--text-secondary);
      font-size: 13px;
      line-height: 1.7;
    }
  }

  .author-section-grid,
  .contact-grid {
    display: grid;
    gap: 16px;
  }

  .author-card {
    padding: 18px;
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    background: var(--card-bg);
    box-shadow: var(--shadow-card);

    &__head {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 16px;

      .el-icon {
        margin-top: 2px;
        color: var(--primary);
      }

      h3 {
        margin: 0;
        font-size: 16px;
      }

      p {
        margin: 6px 0 0;
        color: var(--text-secondary);
        font-size: 12px;
      }
    }
  }

  .partner-table {
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.4);
  }

  .partner-row {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 18px;
    padding: 20px;

    & + .partner-row {
      border-top: 1px solid var(--border-subtle);
    }
  }

  .partner-visual,
  .support-placeholder {
    display: grid;
    min-height: 96px;
    place-items: center;
    border: 1px solid var(--border-subtle);
    border-radius: 18px;
    background: #fff;
    color: var(--text-primary);
    font-weight: 700;

    img {
      max-width: 100%;
      max-height: 96px;
      object-fit: contain;
    }
  }

  .support-placeholder {
    overflow: hidden;

    img {
      width: min(100%, 220px);
      max-height: none;
      aspect-ratio: 1;
      border-radius: 14px;
      object-fit: cover;
    }
  }

  .partner-content {
    display: grid;
    gap: 10px;
    align-content: center;

    h4,
    p {
      margin: 0;
    }

    p {
      color: var(--text-secondary);
      font-size: 13px;
      line-height: 1.7;
    }
  }

  .contact-list {
    display: grid;
    gap: 12px;

    > div {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
    }

    .wechat-qr {
      justify-content: center;

      img {
        width: min(100%, 220px);
        aspect-ratio: 1;
        border-radius: 14px;
        object-fit: cover;
      }
    }

    span {
      color: var(--text-secondary);
      font-size: 13px;
    }
  }

  .support-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .support-item {
    display: grid;
    gap: 8px;

    span {
      color: var(--text-secondary);
      font-size: 12px;
    }
  }
}

@media (max-width: 720px) {
  .author-page {
    .partner-row,
    .support-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
