import { auth } from '@repo/db/auth'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserOrg } from '@/lib/org'

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const input = z
    .object({ orgId: z.string().uuid() })
    .safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: 'Invalid organization' }, { status: 400 })
  if (!(await getUserOrg(session.user.id, input.data.orgId)))
    return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })
  const response = NextResponse.json({ success: true })
  response.cookies.set('active_org', input.data.orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  return response
}
