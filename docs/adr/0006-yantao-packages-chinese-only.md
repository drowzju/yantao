# yantao 包仅中文，放宽 i18n pairing gate

dsh 全库 EN/ZH 双语并带 pairing 校验门。决定：yantao 名下所有包与 app(packages/yantao/**、apps/yantao）仅写中文文案，branch 上对这些路径放宽 i18n pairing gate；上游包的 gate 原样不动。原因：个人单机产品，双语是持续税负而无用户收益。后果：若将来产品外发，需要回补英文并重开 gate。
