/** Browser entry for the yantao workbench: boot the dsh client runtime only. */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

const el = document.getElementById('root')
if (el === null) throw new Error('yantao app: missing #root')
void new AppWebEntry(el).run()
